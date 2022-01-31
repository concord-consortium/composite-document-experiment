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

The description below is outdated, the autorun block has been replaced with a special
action defined on the tile `syncSharedModelWithTileModel` which is called by the 
undoRecorder middleware. 

The current code hasn't dealt with loading and saving yet, so the code doesn't provide
an example of this yet. It will need to be handled in the autorun code that is keeping
things in sync. It should be able to know if the shared model is loaded yet or not
and do different things.

This also means that there will be invalid references in the tile tree while it is
waiting for the shared model to load. So any code referring to these references should
handle this case too. The code could know the shared model is loading and bypass 
any rendering. Or each place that has a reference could be wrapped in `tryReference` or
`isValidReference`. 

# Handling Undo

## Recording undo-able changes
There is a undoRecorder middleware added to the 2 tile trees and the shared model tree.
This middleware is based on the MST undo manager middleware. It uses the 
`createActionTrackingMiddleware2` MST function to make a middleware which automatically
tracks synchronous and asynchronous (flow) actions. 

This MST function also adds support for a shared `env` or context that child actions
can see the parents actions value. The undoRecorder (and original MST undo manager) use
this to only record one entry for the top level action. It uses the `recordPatches` to
record all of the patches that are applied during action or its child actions.

To support shared models, the undoRecorder is configured with the list of paths where
the shared models are mounted in the tile's tree. Changes in this part of the tree are
not included in the patches of the undo entry.

When the undoRecorder detects changes in the shared model part of the tree it calls
a passed in function which is used to sync these changes with the tile's model and 
also with the real shared model.

All recorded entries include a containerActionId. This id should be shared by all
changes that are result of an initial change in a tile. For example when a new node
is added, there are changes in the sharedModel, the diagram model, and the list model.
All of these changes are recorded by independent undoRecorder middlewares but the 
containerActionId is passed around so that all entries share it. 

TODO: find a way to document the complex flow that makes this all work. A sequence
diagram might help. Also coming up with some better names would be useful too.

TODO: in addition to the containerActionId, it would be useful if we recorded 
name of the initial action and its tileId in the undo history. This can help with
debugging, and could also be used in the UI to show the user the undo stack. In the
current implementation if a tile action just changes the shared model, the only
action name is just "applySnapshotFromTile" which isn't very useful.

## Undoing a change
Previous plan for applying undo's is below. This was before I realized the autorun 
approach for translating shared model changes into the tile model wouldn't work. The 
autorun code has now been removed, and it is run by the middleware now. This might 
simplify the steps below.

Outdated plan:
- add a pause option in the autorun that is sync/translating sharedModel <-> tileModel
- when the container does an undo the tile pauses this autorun
- the container sends the tile's changeset
- the tile confirms that its changeset has been applied: this is so the container doesn't
tell it to re-enable the autorun too soon. 
- the container sends or applies the sharedModel changeset
- the sharedModel is synced with all of the tiles
- the tile confirms that the sharedModel has been sync'd: this is so the autorun doesn't
happen too soon. There might be multiple sharedModels used by a tile. The sharedModel
API might not be a simple clone of the sharedModel, there might be a query involved to
get a filtered version of the sharedModel that is used by the tile.
- the container tells the tile to re-enable the autorun, and re-sync/translate its 
  tree with the shared model

Outdated things to note:
- we need a better name for the sync/translating autorun code because it will be a
key part of using shared models.
- the tile UI needs to handle the case where sharedModel references are invalid. It
doesn't mater if the sharedModel changes are applied first or second. There is always
a case where the tile model can be temporarily referencing a sharedModel that doesn't
exist yet.  The 2 basic cases are:  1) the changeset adds a sharedModel item 2) the
changeset removes a sharedModel item. 
TODO: spell this out more carefully.
- because of these temporary invalid times, any tile code that makes changes based
on the sharedModel need to be in the autorun or some construct that can be called 
on demand by the framework.  Example changes are adding or removing nodes that reference
sharedModel items. Or maintaining properties in the tile state that are summaries of
data in the sharedModel.  Basically anytime there is a dependency between the tile 
model and the shared model.
- if the applying of the changes takes a significate amount of time the user might 
make additional changes that can cause conflicts. However this seems like a necessary
trade off so the whole UI doesn't become locked during a simple undo. We'll have to
experiment with this to see how it works in practice.
- this same approach can probably be used when reloading the document, however in that
case it might make sense to lock some parts of document until they are are fully
loaded.
