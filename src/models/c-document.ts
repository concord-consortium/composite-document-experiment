import { types } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { Items } from "./items/items";

export const CDocument = types.model("CDocument", {
    items: Items,
    diagram: DQRoot,
});
