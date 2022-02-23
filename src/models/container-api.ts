import { TreePatchRecordSnapshot } from "./history";

export interface ContainerAPI {
    /**
     * Propagate shared model state to other trees. This is called by either a
     * tile or a shared model
     *
     * The shared model is identified by an id inside of the snapshot The
     * sourceTreeId indicates which tree is sending this update. The new shared
     * model snapshot will not be sent back to this source.
     *
     * Note: The returned promise should only resolve after the shared model has
     * been updated in the container and in all tiles that are using the shared
     * model The promise does not guarantee that all of the tiles have updated
     * their own objects related to the shared model. In particular when this is
     * called by a shared model when it is applying patches from an undo or
     * redo, the tiles will explicitly not update their related objects because
     * they will receive patches that should contain these changes separately.
     *
     * This promise is needed because we need to stop some updating before
     * replaying a history event, and then we need to start it up again
     * afterward. So we need to know when the history event has been fully
     * applied. When the history event includes changes to a shared model, fully
     * applying it means the shared model has sent its update to all of the
     * trees that are using it. So when the shared model tree gets the
     * applyContainerPatches call it then calls this updateSharedModel and waits
     * for it to resolve before resolving its own promise. 
     *
     * The returned promise will also be used when a user event is sent, we need
     * to make sure the container has received this update message before the
     * tree tells the container is done modifying the historyEntry. In this case
     * it isn't necessary for the returned promise to wait until all of the
     * trees have received the message. That could be the responsibility of the
     * container. Perhaps we can take that approach in the other case too so it
     * is symmetrical. 
     */
    updateSharedModel: (historyEntryId: string, callId: string, sourceTreeId: string, snapshot: any) => Promise<void>;
    
    /**
     * Trees should call this to send new changes to the container. These
     * changes are used for 2 things:
     * - the state of the document that is saved and later loaded
     * - the undo stack
     *
     * When the state is loaded the container will combine all of the patches of
     * all of the recorded change entries and send that to the tree with with
     * `applyContainerPatches`.
     *
     * When the user does an undo the container will send the inversePatches of
     * the the change entries that are grouped by the historyEntryId to the tree
     * with `applyContainerPatches`.
     *
     * The tree calling this should wait for it the returned promise to resolve
     * and then send a `addTreePatchRecord`. If the tree is also calling
     * `updateSharedModel` it should wait both the updateSharedModel and the
     * `addHistoryEntry` to resolve before calling `addTreePatchRecord`. 
     * Calling `addTreePatchRecord` is necessary so the container knows the tree
     * is done sending information about this historyEntryId. Because other
     * trees might respond to a sharedModel update with further changes to other
     * sharedModels this might trigger another change back in the original tree.
     * In order to differentiate between the initiating call and the second call
     * the container might use a different id and map it to the same history entry.
     * 
     * TODO: need to rename historyEntryId to be something like callId or
     * messageGroupId. The tree doesn't need to know what this id is beyond when
     * it is being used to group messages being sent to the container. Or to
     * reference that this message is a response to a message from the container.
     * Perhaps, we can streamline this with message channels instead of ids. But
     * I'm not sure how to emulate message channels with a simple promise and id
     * based API. I think it would mean there'd have to be an object created
     * when the initial message is sent or received and future messages would
     * have to be called on that same object.
     * 
     * So when a message is sent that is a primary message (not a response to
     * another message), the sender creates the MessageChannel, adds a listener
     * to port1 and then sends port2 along with the message to the target. The
     * target then uses the port it receives to send a message back. 
     * 
     * If we wanted to use this instead of ids we could have the api return an
     * object when message function is called. Because we probably need to deal
     * with promises too, this object should probably have two fields: a promise
     * and a "port" (need a better name). Then the client of this API would use
     * the port to send additional messages. We can type these ports so that
     * only the follow up messages supported by the port are allowed. We can't
     * guarantee order with this port approach, but it is possible for the
     * receiver of the messages to group them together. 
     * Based on my testing the message channel does do queuing, so if a message
     * is sent to the port before the other port is transferred, when the target
     * adds its listener to the port it will receive the message that was sent
     * in advance. 
     * 
     * So now the next problem is that message channels can't be used for
     * confirming individual messages and for grouping together messages. We'd
     * have to use them for one or the other, and then use ids. Or I suppose we
     * can send message channels over message channels.
     * 
     * If we use the object approach the library that sends the messages could
     * decide whether to use message channels or not, and the same with the id
     * approach. So really it depends on which is better for iframe tiles. I'd
     * that almost all iframe tiles will use a library to communicate and these
     * things should be abstracted away. So that doesn't really matter. So then
     * there is the question of making the library easier to maintain one way or
     * another. Or making it easier to debug. Or making it easier to describe.
     * 
     * Perhaps if the interface to these groups of messages was via a callback
     * instead of returning an object that would make things more clear.
     * 
     * So addHistoryEntry could take a callback that it would call with an
     * object that it could be used to do the next steps. And because these next
     * steps are happening in the callback the code calling the callback can
     * take care of sending the "I'm done" message. But it is hard for me to get
     * my head around this. So I think I'll just stick with the ids for now and
     * maybe if we think it is worth it we can improve this.
     *
     * @param historyEntryId should be a UUID. If this tree is initiating this
     * action it should generate a new UUID.  If the changes in this entry were
     * triggered via an `applySharedModelSnapshotFromContainer` call this id
     * should be the `historyEntryId` that was passed to the tree by
     * `applySharedModelSnapshotFromContainer`.
     *
     * @param treeChangeEntry This contains the patches and inversePatches of
     * this change entry.
     *
     * @param undoableAction true if this action should be saved to the undo
     * stack. Changes that result from `applyContainerPatches` should not be
     * undo-able.
     */    
    addHistoryEntry: (historyEntryId: string, callId: string, treeId: string, actionName: string, undoable: boolean) => Promise<void>;
    
    /**
     *
     * TODO: there is no "finish" event. So in a system that is sharing document
     * changes it won't be possible to know when to send the history entry to
     * the other computers. Perhaps it is best to just send the patch records as
     * they come in. The problem will be replaying them. So without a "finish"
     * event we'd have to use some kind of timer to know when the history entry
     * is done. 
     *
     * Adding a "finish" event is hard. We don't know which trees will be
     * affected by any changes to the shared model, and whether those trees
     * might trigger updates in other shared models which can cascade down. Each
     * time a tree gets an updated from the container it would have to respond
     * to the container about which shared models it is updating. Then the
     * container can know which trees that shared model is used by and wait for
     * that complete as well as waiting for responses about updates that those
     * trees might be making.
     */
    addTreePatchRecord: (historyEntryId: string, callId: string, record: TreePatchRecordSnapshot) => void;

    /**
     * This starts a new "call" in the history entry. These calls are used by
     * the container to know when the history entry is complete. If there are
     * any open "calls", then the history entry is still recording.
     * `addHistoryEntry` automatically starts a "call".  And when the container
     * calls into the tree with applyContainerPatches, the container starts a
     * "call". This explicit startHistoryEntryCall is only needed when the tree
     * wants to start some async code outside of one of these existing calls. It
     * should make sure to wait for the promise of startHistoryEntryCall to
     * resolve before it closes out one of the existing "calls". This way the
     * container knows the history entry is still open. 
     * 
     * FIXME: need a new name for "call". It is used as verb too often. And it
     * also represents the object used by MST to store information about an
     * action. 
     */
    startHistoryEntryCall: (historyEntryId: string, callId: string) => Promise<void>;
}
