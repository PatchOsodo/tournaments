/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_485997869")

  // add field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1040384302",
    "max": 0,
    "min": 0,
    "name": "bracket_side",
    "pattern": "winners losers grand_final",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_485997869")

  // remove field
  collection.fields.removeById("text1040384302")

  return app.save(collection)
})
