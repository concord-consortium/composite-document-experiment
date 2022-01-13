import { types } from "mobx-state-tree";
import { ItemList } from "../models/item-list/item-list";
import { DQRoot } from "./diagram/dq-root";
import { SharedModel } from "./shared-model/shared-model";

export const CDocument = types.model("CDocument", {
    sharedModel: SharedModel,
    diagram: DQRoot,
    itemList: ItemList
});
