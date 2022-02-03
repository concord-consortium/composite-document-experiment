import {
    IAnyStateTreeNode,
    recordPatches,
    IPatchRecorder,
    createActionTrackingMiddleware2, flow,
    addMiddleware,
    addDisposer, isActionContextThisOrChildOf, IJsonPatch, IActionTrackingMiddleware2Call
} from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";

export interface RecordedEntry {
    containerActionId: string,
    actionName: string,
    patches: ReadonlyArray<IJsonPatch>,
    inversePatches: ReadonlyArray<IJsonPatch>
}

interface CallEnv {
    recorder: IPatchRecorder;
    sharedModelModifications: SharedModelModifications;
    containerActionId: string;
}

// A map of shared model paths to their update functions
type SharedModelChangeHandler = (containerActionId: string, call: IActionTrackingMiddleware2Call<CallEnv>) => void;
export type SharedModelsConfig = Record<string, SharedModelChangeHandler>;
type SharedModelModifications = Record<string, number>;

// This seems to work better not being an MST model, it doesn't
// need to record state its self. 
export const createUndoRecorder = (targetStore: IAnyStateTreeNode, onRecorded: (entry: RecordedEntry) => void,
    includeHooks: boolean, sharedModelsConfig: SharedModelsConfig = {}) => {
    let recordingDisabled = 0;

    const undoRedoMiddleware = createActionTrackingMiddleware2<CallEnv>({
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

            let containerActionId;

            // TODO: this seems like a bit of a hack. We are looking for specific actions
            // which we know include a containerActionId as their first argument
            // this is so we can link all of the changes with this same containerActionId
            // These actions are all defined on the common `Tile` model which is
            // composed into the actual tiles of Diagram and ItemList. So at least
            // the specific tile are not defining these actions themselves.
            //
            // I can't think of a better way so far. 
            // If a function in this middleware could apply the snapshots and run the 
            // syncing that would let us directly pass in the containerActionId. However
            // we still need to record the changes in the undo history. So we still need
            // this to pass through as an action so the middleware can record it.
            //
            // We could use the `decorate` feature of MST to at least make it more clear
            // in the Tile model that these actions are special. 
            if (call.name === "applySnapshotFromTile" || 
                call.name === "applySharedModelSnapshotFromContainer" ||
                call.name === "updateTreeAfterSharedModelChangesInternal") {
                containerActionId = call.args[0];
            } else {
               containerActionId = uuidv4();
            }

            const recorder = recordPatches(
                call.tree,
                (_patch, _inversePatch, actionContext) => {
                    // We skip recording when we are applying patches from the undo store
                    // these could be undo or redo patches
                    if (recordingDisabled || call.name === "applyPatchesFromUndo") {
                        return false;
                    }

                    // Filter out patches that are modifying the exclude path. 
                    // Because we need to track when the cached shared models is changed during this
                    // action we either need to record just that fact or record all patches
                    // and filter later
                    if (sharedModelsConfig) {
                        const sharedModelPath = sharedModelPaths.find((path) => _patch.path.startsWith(path));
                        if (sharedModelPath) {
                            // FIXME: a problem with this approach is that we treating all changes within 
                            // the sharedModelPath the same. 
                            // If the change is simple property change in the cached shared model that
                            // isn't used by the syncing function, we do not need to re-run this function.
                            // When we used the autorun approach this was optimized so the function would
                            // only run when the parts of the tree changed that mattered.
                            // We do still need to run the sync between the shared model cache
                            // and the main shared model with these changes, but that is currently handled
                            // by the onAction handler which fires all of the time.
                            // There might be a way to use the mobx internals so the sync function can 
                            // be bypassed if its dependencies aren't changed. Or perhaps there is a better
                            // way to trigger these kinds of updates in a context where we still have access
                            // the main action.
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

            // TODO: Generate a containerUndoId if there isn't one already set
            call.env = {
                recorder,
                sharedModelModifications,
                containerActionId
            };
        },
        onFinish(call, error) {
            const { recorder, sharedModelModifications, containerActionId } = call.env || {};
            if (!recorder || !sharedModelModifications || !containerActionId) {
                throw new Error("The call.env is corrupted");
            }
            call.env = undefined;
            recorder.stop();

            if (error === undefined) {
                addUndoState(recorder, call.name, containerActionId);
                // TODO: Trigger shared model translating/syncing if the shared data model changed.
                // This might be both the syncing of the shared model to the container, and the syncing of 
                // within the tile between the 'cached' shared model with the tile's model.
                // Previously this internal sync'ing was done using an autorun to monitor the models. 
                // But that doesn't have access to the action that triggered the sync, and that action is
                // needed so we can group the changes together so we can undo them later.
                // So we need to pass in a object with call back for each shared model and its path so we know which
                // ones to sync
                Object.entries(sharedModelModifications).forEach(([path, numModifications]) => {
                    if (numModifications > 0) {
                        // Tell the shared model update function to run
                        // we probably have to pass it something here
                        // this will likely be an action on a model in the tree being watched so we'll need
                        // to prevent this from causing an infinite loop
                        sharedModelsConfig[path](containerActionId, call);
                    }
                });
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
     * The internal actions modify the recorded tree, so they should be skipped for
     * purposes of undo. However, in order to support time travel that includes undo
     * and redo we will need to record them somewhere, but perhaps that would be a
     * separate middleware.
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
    const middlewareDisposer = addMiddleware(targetStore, undoRedoMiddleware, includeHooks);

    // We might need an option to not add this disposer, but it seems it would generally
    // ge a good thing to do.
    addDisposer(targetStore, middlewareDisposer);

    const addUndoState = (recorder: IPatchRecorder, actionName: string, containerActionId: string) => {
        if (recorder.patches.length === 0) {
            // skip recording if patches is empty
            return;
        }

        // Instead of pushing to the history it might be better if this had a 
        // handler that was sent the new entry
        onRecorded({
            containerActionId,
            actionName,
            patches: recorder.patches,
            inversePatches: recorder.inversePatches
        });
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
