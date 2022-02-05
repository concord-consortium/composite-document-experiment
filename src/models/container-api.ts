
export interface ContainerAPI {
    /**
     * Propagate shared model state to other trees. 
     * This is called by either a tile or a shared model
     * 
     * The shared model is identified by an id inside of the snapshot
     * The sourceTreeId indicates which tree is sending this update.
     * The new shared model snapshot will not be sent back to this source.
     * 
     * Note: The returned promise should only resolve after the shared model has been 
     * updated in the container and in all tiles that are using the shared model
     * The promise does not guarantee that all of the tiles have updated their own 
     * objects related to the shared model.
     * In particular when this is called by a shared model when it is applying patches 
     * from an undo or redo, the tiles will explicitly not update their related objects
     * because they will receive patches that should contain these changes separately.
     */
    updateSharedModel: (containerActionId: string, sourceTreeId: string, snapshot: any) => Promise<void>;
}
