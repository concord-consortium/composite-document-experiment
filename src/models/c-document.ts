import { types } from "mobx-state-tree";
import { ItemList } from "../models/item-list/item-list";
import { DQRoot } from "./diagram/dq-root";
import { Items } from "./items/items";

export const CDocument = types.model("CDocument", {
    items: Items,
    diagram: DQRoot,
    itemList: ItemList
});
