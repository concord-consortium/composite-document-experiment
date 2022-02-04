
export interface ContainerAPI {
    // The returned promise should only resolve after the shared model has been updated
    // in container and in all tiles that are using the shared model
    // The promise does not guarantee that all of the tiles have updated their own 
    // objects related to the shared model.
    // In particular when this is called by a shared model when it is applying patches 
    // from an undo or redo, the tiles will explicitly not update their related objects
    // because the will receive patches that should contain these changes separately. 
    updateSharedModel: (containerActionId: string, tileId: string, snapshot: any) => Promise<void>;
}
