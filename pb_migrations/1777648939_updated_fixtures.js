/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_485997869")

  // add field
  collection.fields.addAt(14, new Field({
    "help": "Round number the winner advances to",
    "hidden": false,
    "id": "number2448859232",
    "max": null,
    "min": null,
    "name": "next_winner_round",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "help": "",
    "hidden": false,
    "id": "number776179537",
    "max": null,
    "min": null,
    "name": "next_winner_match",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1779654033",
    "max": 0,
    "min": 0,
    "name": "next_winner_slot",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(17, new Field({
    "help": "",
    "hidden": false,
    "id": "number3350321609",
    "max": null,
    "min": null,
    "name": "next_loser_round",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "help": "",
    "hidden": false,
    "id": "number2013591288",
    "max": null,
    "min": null,
    "name": "next_loser_match",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(19, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2662258596",
    "max": 0,
    "min": 0,
    "name": "next_loser_slot",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // update field
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "help": "Stores 'winners', 'losers', or 'grand_final'",
    "hidden": false,
    "id": "text1040384302",
    "max": 0,
    "min": 0,
    "name": "bracket_side",
    "pattern": "",
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
  collection.fields.removeById("number2448859232")

  // remove field
  collection.fields.removeById("number776179537")

  // remove field
  collection.fields.removeById("text1779654033")

  // remove field
  collection.fields.removeById("number3350321609")

  // remove field
  collection.fields.removeById("number2013591288")

  // remove field
  collection.fields.removeById("text2662258596")

  // update field
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
})
