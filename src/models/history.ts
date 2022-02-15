import { types, IJsonPatch, SnapshotIn } from "mobx-state-tree";

export const TreePatchRecord = types.model("TreePatchRecord", {
    tree: types.string,
    action: types.string,
    patches: types.frozen<ReadonlyArray<IJsonPatch>>(),
    inversePatches: types.frozen<ReadonlyArray<IJsonPatch>>()
})
.views(self => ({
    getPatches(opType: HistoryOperation) {
        switch (opType) {
            case HistoryOperation.Undo:
                return self.inversePatches.slice().reverse();
            case HistoryOperation.Redo:
                return self.patches;
        }
    }
}));
export interface TreePatchRecordSnapshot extends SnapshotIn<typeof TreePatchRecord> {}


export const HistoryEntry = types.model("HistoryEntry", {
    id: types.identifier,
    tree: types.maybe(types.string),
    action: types.maybe(types.string),
    // This doesn't need to be recorded in the state, but putting it here is
    // the easiest place for now.
    undoable: types.maybe(types.boolean),
    created: types.optional(types.Date, () => new Date()),
    records: types.array(TreePatchRecord)
});

export enum HistoryOperation {
    Undo = "undo",
    Redo = "redo"
}
