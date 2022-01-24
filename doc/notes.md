# MST destroy

Destroy modifies the parent of the object being destroyed. This can cause hard to figure
out errors. For example if the object tries to destroy itself in an action on its self 
this will fail. The error in this case is not obvious. It will be something like:

`[mobx-state-tree] Cannot modify 'map<string, Item>@/items/allItems', the object is protected and can only be modified by using an action.`

The reason it fails is because actions can only modify their own object or children of
their object. Calling destroy is modifying a parent of the object, so that isn't allowed.

The error message doesn't tell you that you are in an action already. So it seems like 
error message is wrong.

It would be nice if MST could identify it is in global action and print the path of 
the object that owns the action along with a more informative message. I looked at the
code and didn't see an obvious way to do this, but it seems possible.

# Issues with MST onInvalidated 

The behavior or onInvalidated when snapshots are being applied is confusing and 
seeming unpredictable.

In some cases calling applySnaphot with a snapshot containing an invalid
reference does not trigger onInvalidated. 

In other cases onInvalidated is triggered in this case. However if the 
onInvalidated handler makes a change to the tree synchronously, this change
might not stick.

I believe both of these inconsistencies happen because of order that the changes
in the snapshot are applied. If onInvalidated is called in the middle of applying
the snapshot then the remainder of the snapshot might overwrite any changes
made by onInvalidated. Also if the deletion of the object being referenced 
happens after the reference itself has been applied then the onInvalidated 
trigger might not happen. Both of those are just guess though, I haven't figured
out the code enough to know for sure.

Because of these inconsistences, the code now uses autorun to keep keep track
of the invalidation of references. This autorun approach seems to work 
consistently and it is also necessary to add new nodes when syncing a list
or map so it makes sense to put the code in the same place. 

Some notes about this. This comment is informative:

https://github.com/mobxjs/mobx-state-tree/blob/f297ae28159a9c3b276ed5052021f642d74ca919/packages/mobx-state-tree/__tests__/core/reference-custom.test.ts#L154

# Syncing shared model

Most tiles will store some state related to the shared model. For example a table tile
might save the position of a column in a shared data set model. This position information
needs to relate to something in the shared model. The example here uses MST references
to keep track of this. 

If the thing being referenced in the shared model is deleted. Or a new similiar thing
is added the tile needs to stay synchronized. So for example with the table tile if the
column is delete then the table tile's position info should be deleted too. Or if a new
column is added this table tile needs to decide what position to put this new column in.

Because shared models might get loaded after the tile itself, the tile should deal with 
two cases:
- the shared model is not loaded yet, so the tile should not delete its related objects.
- the shared model has been loaded and an item is actually deleted most likely by 
another tile.  

The current code hasn't dealt with loading and saving yet, so the code doesn't provide
an example of this yet. It will need to be handled in the autorun code that is keeping
things in sync. It should be able to know if the shared model is loaded yet or not
and do different things.

This also means that there will be invalid references in the tile tree while it is
waiting for the shared model to load. So any code referring to these references should
handle this case too. The code could know the shared model is loading and bypass 
any rendering. Or each place that has a reference could be wrapped in `tryReference` or
`isValidReference`. 
