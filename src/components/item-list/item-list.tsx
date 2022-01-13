import { observer } from "mobx-react-lite";
import { Instance } from "mobx-state-tree";
import React, { useEffect } from "react";
import { Reorder } from "framer-motion";
import { autorun } from "mobx";

import { SharedModel } from "../../models/shared-model/shared-model";
import { ItemList as ItemListModel, ItemListItem } from "../../models/item-list/item-list";

interface IProps {
  itemList: Instance<typeof ItemListModel>;
  sharedModel: Instance<typeof SharedModel>;
}

// FIXME: instead of directly passing in the sharedModel here,
// the itemList model should work with the sharedModel directly
// this way multiple items shared data models can be supported in the same
// document. 
// Additionally it then becomes the responsibility of the model to keep
// the two lists in sync
export const _ItemList: React.FC<IProps> = ({itemList, sharedModel}) => {
  // TODO: move this to the model
  // TODO: analyze performance, does this run when the name changes? We should try to 
  // keep it from running this this case. The goal is just to keep the references in sync
  useEffect(() => {
    const disposer = autorun(() => {
        Array.from(sharedModel.allItems.values()).forEach(item => {
          // sync up shared data model items with the tile data of items
          // look for this item in the itemList, if it is not there add it
          const matchingItem = itemList.allItems.find(itemListItem => itemListItem.sharedItem.id === item.id);
          if (!matchingItem) {
              const newItem = ItemListItem.create({ id: itemList.getNextId().toString(), sharedItem: item.id });
              itemList.addItem(newItem);
          }
        });
    
        // When an item is deleted from the shared data model the onInvalidated callback of the item
        // reference is called. So this should clean up the the related itemListItem
      });
    return disposer;    
  }, [itemList, sharedModel]);

  // TODO: figure out how to handle selection with the sync'd tree approach
  // const [selectedNode, setSelectedNode] = useState<Instance<typeof DQNode> | undefined>();

  const itemValues = Array.from(itemList.allItems.values());

  return (
    <div className="item-list" >
      <Reorder.Group axis="y" values={itemValues} onReorder={(updatedItems) => itemList.setItems(updatedItems)}>
        { itemValues.map( item => (          
            item ? 
              <Reorder.Item key={item.id} value={item}>
                  {item.name}
              </Reorder.Item>
              : null
        )) }
      </Reorder.Group>
    </div>
  );
};

export const ItemList = observer(_ItemList);
ItemList.displayName = "ItemList";
