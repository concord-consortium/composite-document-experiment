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

Plan with sync/translating happening in undo-recorder middleware. 
- the container tells all tiles to pause their syncing code. This could be optimized to
only stop the tiles affected by the undo.
- the container sends the undo patch to each tile
- when tile receives a patch to apply, the patch shouldn't be undoable itself. Because
the syncing is paused the patch shouldn't trigger a sync of the shared model.
- the container sends the sharedModel patch
- the sharedModel is synced with all of the tiles
- TODO: the tile confirms that the sharedModel has been sync'd: this is so the internal sync 
doesn't happen too soon. There might be multiple sharedModels used by a tile. The sharedModel
API might not be a simple clone of the sharedModel, there might be a query involved to
get a filtered version of the sharedModel that is used by the tile.
- the container tells the tile to re-enable the syncing code, and do a "catch-up" sync. 

Is it really necessary to pause all tile syncing code? Could we just not 
sync when sending the tile patches? The issue is that the sharedModel will be sent to
the tile in a separate message. It seems best if we don't require the tile patches to 
happen before the shared model patches. And there might be multiple shared models 
each triggering their own sync.  You'd think it would work if we do this:
- don't sync when a patch is received
- don't sync when the sharedModel snapshot is received
- the container tells the tile to an explicit sync after it has sent all patches

However the user might do some actions while this is happening, and these actions
could cause a sync to happen. For example the user might change the name of a node.
This change would be applied directly to cached shared model of the tile. Then 
the whole cached shared model would be sync'd with the tile model. If the undo
patches of the shared model had been applied already but not the tile model patches,
and the shared model now had a new node in it, this new node would be created by
the syncing code. Then the tile model patch would get applied which would create
a another new node. So now there would be two new nodes created pointing at the 
same shared model node. 

So the tile level disabling of sync is necessary to make sure all patches have
been applied before we try to sync up any inconsistencies. 

Previous plan for applying undo's is below. This was before I realized the autorun 
approach for translating shared model changes into the tile model wouldn't work. The 
autorun code has now been removed, and it is run by the middleware now. This might 
simplify the steps below.

Outdated Autorun plan:
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

Comment that was in the container before:

    The container takes a simple approach right now. It acts as a repeater of messages
    sent by each tile. The message includes the tile's state of shared model. The
    container only sends the message to the tiles that didn't send the message.

    Right now the container is the one watching the tile trees with `onAction`
    In a real scenario where the tiles are managing their own trees (sometimes in
    an iframe) the tile would watch its own tree. See the first
    onAction handler for more details about this.

    This repeater approach avoids the simple infinite loop. However if there is a delay 
    in the message passing then it can result some strange cases. Also if a tile
    updated the shared model in response to a change made by a different tile 
    there still could be an infinite loop. A simple example are tiles that are 
    sharing numbers represented by strings. Perhaps one tile wants to always have
    1 digit of precision "1.0" and the other wants "1.00". Whenever the number changes
    the two tiles will just keep updating the same number again and again. 
    I don't think there is much we can do to prevent this. But perhaps we could 
    add some kind of loop detection code.

    This approach also doesn't support shared models that have their own logic or 
    reactions. I do not have a use case yet where the shared model needs it own
    logic. An example would be a shared model that wants to keep its items sorted,
    but that doesn't seem like a good case.

    If we do have a good use case, this seems possible to handle, but it adds 
    complexity. The shared model might need to send state back to the tile. So
    to avoid the infinite loop problem both the shared model and the tile should
    keep track of the last state they received and not resend if it matches. This
    could be done with a hash to save memory. But if we want to also reduce the
    amount of data shipped around a full copy is useful so then we can just send
    diffs. 

    Before we add that complexity we should see if there is a use case where the 
    shared model needs to make its own changes. 
    
    Another version of this is if we want to support two tiles changing the state
    at the same time. In this case we might need to send state back to the tile
    immediately after the tile sent state because another tile modified it
    while it was in transit. But again we don't have a good use case for this.

# Naming

The thing the container contains could be call "trees". It these trees need to be
kept in sync. A tile or shared model are two types of trees. This is less
generic than "model".

Now we need a name for the shared model that is mounted inside of a tile tree.
The main shared model could be called the source. And thing mounted in the 
tile could be a shadow. I think it would be more useful if the shared model 
represented the abstract concept of sharing state. So then we need names for
the 2 ways that is represented in the system. 

We have talked about tiles containing a subset of the shared model and I've 
referred to that as a "view" of the shared model. So we could call these
shared model views.  In the implementation so far the view is just the full
model. The other one could be the shared model tree. It would be nice to use
the generic name of things in the container here. But a shared model tree
isn't clear to me. So maybe this will help us come up with a better name.
- shared model source
- shared model container
- shared model origin
- shared model state
- shared model tree
- shared model model
- shared model root
- main shared model
- shared model database
- principal shared model
- shared model arbol
- shared model raiz (spanish for root)

The shared model tree needs to be sent to each tile's shared model view.
The shared model view needs to be synced with the tile's models.
The container has a collection of trees.
The patches of need to be applied to the trees.
The shared model view is mounted in the tile tree.
The container can also have tree proxies so it can work with tiles or shared models in iframes or workers.


A problem with making a shared model both a tree and the actual model is that 
the actual model is used directly inside of the tile tree. So we don't want 
all of the tree features, just the bare model. 
A way around this to have the shared model be a child of the shared model tree
But this then complicates a few things:
- we are using the id in the shared model's snapshot to identify which shared model
  to update. If this was a child of the tree then applying the snapshot and patches
  would not be symmetrical between the tree and shared model. 

Another way to handle this, is to have the tree be a composite of the shared model
and the tree. But the when the shared model is used in the tile tree just the 
shared model is used. This is a bit mind bending, but might work...

It does mean that the shared model and tree would both need to declare an id property.
Also I wonder if the snapshots will apply correctly, it seems like they should. 

# Recreating Problematic async case 1

The timing of the undo of a node deletion is important:

- the container has told the tile that it is done applying patches 
- because of a delay in the system it is not actually done
- the shared model is updated but the snapshot of it is sent to the tile after this finished message 
- this triggers the tile's updateTreeAfterSharedModelChanges to run
- the list tile will add a new item to its tree for the newly added shared model item
- now the patches of the list item itself are sent to the list tile, these were also delayed
  that is why they are happening late
- at this point the patches create a new node in the list tile's tree
- so now there are 2 new nodes in the list tile's tree instead of one.

Additionally these 2 nodes have the same id and reference the same shared model item.
An exception will be shown in the console because the keys of the elements in React match.

# Recreating Problematic async case 2

With an artificial delay added to when the shared data model tells the
container to update all tiles that are viewing it, a problem can occur. This
kind of delay seems unlikely since it seems in most cases shared models will be 
running in the clue core.

However it is possible that the sending of the state to the tiles from the container
could be delayed since this would be going through the iframe boundary.

With this kind of delay a problem can be shown by:
1. adding a node
2. move the new node to the top of the list
3. delete the node
4. undo the last change.
 
If the shared model is not sent to the tile soon enough, then the tiles delete their
copy of the node since it is not yet in the shared model view. This will happen when
the updateTreeAfterSharedModelChanges is called by the finishApplyingPatches call.
The updateTreeAfterSharedModelChanges deletes nodes because it is trying to keep the 
tile's references to these shared models in sync with the shared model.
when the shared model is finally sent, this causes updateTreeAfterSharedModelChanges 
to run again and now the tile recreates a node/item for this shared item.

This has 2 effects:
- the internal state associated with the node/item is lost (its position in the list,
or position on the diagram)
- the undo stack will be broken because there will be changes applied outside of 
  applyPatchesFromUndo, so these changes are recorded on the undo stack. So now the next undo 
  will not go back in time, but instead just try to undo the mess that was caused
  before. From testing this resulted in 3 entries added to the stack:
  1. finishApplyingContainerPatches on the diagram with a removal of the node
  2. finishApplyingContainerPatches on the list with a a removal of the item
  3. a single entry with updateTreeAfterSharedModelChangesInternal actions from the 
     diagram and list. Which are adding the node back.
  I haven't thought through this deeply, but that list makes sense. This is one example
  of how errors updateTreeAfterSharedModelChanges can result in hard to find errors.
  This is more reason to add error checking to that so we can catch these errors
  sooner.

This is fixed by returning promises from the chain that don't resolve until the
shared model changes have been applied. 

TODO: it seems like there might be a case where the promise chain could get really
long. I want to trace this through to see how long this could get.

# Saving state

What I want to do is have a single container api for the tiles to send changes
to.
The changes can be flagged if they should be undoable or not.

To optimize memory the container can store a single copy of the change entry,
but because this is a prototype it is probably easier to just maintain two
separate copies of the changes. We want them independent parts of the tree so we
can get a snapshot of just the fullHistory part of the tree.

This also means the undoStore is no longer an undo store. It is now more like a
document store that has an undo stack section.

When we undo and redo we could record these things into the documentStore
directly without requiring the trees to send updated patches. But it seems
better to let the trees do this just incase something applies different when the
patch is applied to the actual tree.