import {
    recordPatches,
    IPatchRecorder,
    createActionTrackingMiddleware2, flow,
    addMiddleware,
    addDisposer, isActionContextThisOrChildOf, IActionTrackingMiddleware2Call, Instance
} from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";
import { ContainerAPI } from "../container-api";
import { TreePatchRecordSnapshot } from "../history";
import { Tree } from "../tree";

interface CallEnv {
    recorder: IPatchRecorder;
    sharedModelModifications: SharedModelModifications;
    historyEntryId: string;
    callId: string;
}

// A map of shared model paths to their update functions
type SharedModelChangeHandler = (historyEntryId: string, callId: string, call: IActionTrackingMiddleware2Call<CallEnv>) => void;
export type SharedModelsConfig = Record<string, SharedModelChangeHandler>;
type SharedModelModifications = Record<string, number>;

// This seems to work better not being an MST model, it doesn't
// need to record state its self. 
export const addTreeMonitor = (tree: Instance<typeof Tree>, container: ContainerAPI, 
    includeHooks: boolean, sharedModelsConfig: SharedModelsConfig = {}) => {
    let recordingDisabled = 0;

    const treeMonitorMiddleware = createActionTrackingMiddleware2<CallEnv>({
        filter(call) {
            if (call.env) {
                // already recording
                return false;
            }
            return true;
        },
        onStart(call) {
            const sharedModelPaths = Object.keys(sharedModelsConfig);
            const sharedModelModifications: SharedModelModifications = {};

            // Initialize how we record the shared model changes
            sharedModelPaths.forEach((path) => sharedModelModifications[path] = 0);

            let historyEntryId;
            let callId;

            // TODO: this seems like a bit of a hack. We are looking for specific actions
            // which we know include a historyEntryId as their first argument
            // this is so we can link all of the changes with this same historyEntryId
            // These actions are all defined on the common `Tree` model which is
            // composed into the actual tiles and shared models. So at least
            // the specific trees are not defining these actions themselves.
            //
            // I can't think of a better way so far. 
            // If a function in this middleware could apply the snapshots and run the 
            // syncing that would let us directly pass in the historyEntryId. However
            // we still need to record the changes in the undo history. So we still need
            // this to pass through as an action so the middleware can record it.
            //
            // We could use the `decorate` feature of MST to at least make it more clear
            // in the Tile model that these actions are special. 
            if (isActionFromContainer(call)) {
                historyEntryId = call.args[0];
                callId = call.args[1];
            } else {
                historyEntryId = uuidv4();
                callId = uuidv4();
            }

            const recorder = recordPatches(
                call.tree,
                (_patch, _inversePatch, actionContext) => {
                    if (recordingDisabled) {
                        return false;
                    }

                    // See if the patch is modifying one of the mounted shared model views
                    // If it is then don't record this patch, and also track the modification
                    // so we can notify the tree when the action is done.
                    // The tree needs to know about these modifications so it can update
                    // itself from changes in the shared model view, and so it can send these
                    // changes to the container.
                    if (sharedModelsConfig) {
                        const sharedModelPath = sharedModelPaths.find((path) => _patch.path.startsWith(path));
                        if (sharedModelPath) {
                            // increment the number of modifications made to the shared model
                            sharedModelModifications[sharedModelPath]++;
                            // don't record this patch because it will be recorded by the shared model itself
                            return false;
                        }
                    }

                    // only record patches that were generated by this action or children of this action
                    return (
                        !!actionContext && isActionContextThisOrChildOf(actionContext, call.id)
                    );
                }
            );
            recorder.resume();

            call.env = {
                recorder,
                sharedModelModifications,
                historyEntryId,
                callId
            };
        },
        onFinish(call, error) {
            const { recorder, sharedModelModifications, historyEntryId, callId } = call.env || {};
            if (!recorder || !sharedModelModifications || !historyEntryId || !callId) {
                throw new Error(`The call.env is corrupted: ${ JSON.stringify(call.env)}`);
            }
            call.env = undefined;
            recorder.stop();

            if (error === undefined) {
                // TODO: we are going to make this async because it needs to
                // wait for the container to respond, to the start call before
                // finishing the action.  But we should check that this delayed
                // function doesn't access something from the tree that might
                // have changed in the meantime.
                recordAction(call, historyEntryId, callId, recorder, sharedModelModifications);
            } else {
                // TODO: This is kind of a new feature that is being added to the tree by the undo manager
                // any errors that happen during an action will cause the tree to revert back to 
                // how it was before. 
                // This might be a good thing to do, but it needs to be analysed to see what happens
                // with the shared models when the patches are undone.
                recorder.undo();
            }
        }
    });

    /**
     * This is used both internally to skip recording the undo and redo actions, and
     * to allow code using this middle ware to skip certain actions.
     *
     * The `recordingDisabled` counter is used above in onStart in its recordPatches
     * callback. Note that this is global setting. So if something starts skipping
     * recording that would be applied to all actions even un related asynchronous
     * ones.
     */
    const skipRecording = <T>(fn: () => T): T => {
        recordingDisabled++;
        try {
            return fn();
        } finally {
            recordingDisabled--;
        }
    };

    // I'd guess in our case we always want to include hooks. If a model makes some 
    // changes to its state when it is added to the tree during an action we'd want that
    // to be part of the undo stack.  
    //
    // TODO: however perhaps this setting is just for the initial action. So perhaps even
    // without this the creation of a model would be recorded by the recorder if it was
    // a done in a child action. So we should do some experimentation with middleware
    // the recorder and hooks.
    const middlewareDisposer = addMiddleware(tree, treeMonitorMiddleware, includeHooks);

    // We might need an option to not add this disposer, but it seems it would generally
    // ge a good thing to do.
    addDisposer(tree, middlewareDisposer);

    const recordAction = async (call: IActionTrackingMiddleware2Call<CallEnv>, historyEntryId: string, callId: string,
        recorder: IPatchRecorder, sharedModelModifications: SharedModelModifications) => {    
        if (!isActionFromContainer(call)) {
            // We record the start of the action even if it doesn't have any
            // patches. This is useful when an action only modifies the shared
            // tree
            //
            // We only record this when the action is triggered by the
            // container. If the container triggered the action then it is up to
            // the container to setup this information first.
            await container.addHistoryEntry(historyEntryId, callId, tree.id, call.name, true);
        }
    
        // Call the shared model notification function if there are changes. 
        // This is needed so the changes can be sent to the container,
        // and so the changes can trigger a update/sync of the tile model
        // Previously this internal updating or sync'ing was done using an autorun to monitor the models. 
        // But that doesn't have access to the action id that triggered the sync, and that action id is
        // needed so we can group the changes together so we can undo them
        // later.
        for (const [path, numModifications] of Object.entries(sharedModelModifications)) {
            if (numModifications > 0) {
                // Run the callback tracking changes to the shared model
                // We need to wait for these complete because the container
                // needs to know when this history entry is complete. If it gets
                // the addTreePatchRecord before any changes from the shared
                // models it will mark the entry complete too soon.
                await sharedModelsConfig[path](historyEntryId, callId, call);
            }
        }

        // Always send the record to the container even if there are no
        // patches. This API is how the container knows the callId is finished. 
        const record: TreePatchRecordSnapshot = {
            tree: tree.id,
            action: call.name,
            patches: recorder.patches,
            inversePatches: recorder.inversePatches,
        };
        container.addTreePatchRecord(historyEntryId, callId, record);
    };

    return {
        middlewareDisposer,

        withoutUndo<T>(fn: () => T): T {
            return skipRecording(fn);
        },
        withoutUndoFlow(generatorFn: () => any) {
            return flow(function* __withoutUndoFlow__() {
                recordingDisabled++;
                try {
                    return yield* generatorFn();
                } finally {
                    recordingDisabled--;
                }
            });
        },
    };
};

function isActionFromContainer(call: IActionTrackingMiddleware2Call<CallEnv>) {
    return call.name === "applySharedModelSnapshotFromContainer" ||
        // updateTreeAfterSharedModelChangesInternal is not always an action
        // from the container. It can happen when a tree modifies it local
        // shared model view and that triggers an update of the rest of the
        // state of the tree.
        call.name === "updateTreeAfterSharedModelChangesInternal" ||
        call.name === "applyContainerPatches" ||
        call.name === "startApplyingContainerPatches" ||
        call.name === "finishApplyingContainerPatches";
}
