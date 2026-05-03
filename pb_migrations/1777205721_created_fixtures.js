/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "cascadeDelete": true,
        "collectionId": "pbc_340646327",
        "help": "",
        "hidden": false,
        "id": "relation3177167065",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "tournament",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "help": "Round number (1, 2, 3...)",
        "hidden": false,
        "id": "number3320769076",
        "max": null,
        "min": null,
        "name": "round",
        "onlyInt": true,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "help": "Match number within the round",
        "hidden": false,
        "id": "number939517525",
        "max": null,
        "min": null,
        "name": "match_number",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "help": "Display label e.g. \"Semifinals\", \"Round 1\"",
        "hidden": false,
        "id": "text3637789713",
        "max": 0,
        "min": 0,
        "name": "round_label",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_1568971955",
        "help": "→ teams (single). Null if TBD or bye ",
        "hidden": false,
        "id": "relation3854964688",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "home_team",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_1568971955",
        "help": "→ teams (single). Null if TBD or bye ",
        "hidden": false,
        "id": "relation1435444097",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "away_team",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "help": "Filled in when result is entered",
        "hidden": false,
        "id": "number962842305",
        "max": null,
        "min": null,
        "name": "home_score",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "help": "Filled in when result is entered",
        "hidden": false,
        "id": "number633333399",
        "max": null,
        "min": null,
        "name": "away_score",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "cascadeDelete": false,
        "collectionId": "pbc_1568971955",
        "help": "→ teams (single). Set by result logic ",
        "hidden": false,
        "id": "relation217473038",
        "maxSelect": 0,
        "minSelect": 0,
        "name": "winner",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "One of: scheduled, completed",
        "hidden": false,
        "id": "text2063623452",
        "max": 0,
        "min": 0,
        "name": "status",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "True if one team has a bye this match",
        "hidden": false,
        "id": "bool995308284",
        "name": "is_bye",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "autogeneratePattern": "",
        "help": "Group identifier for group stage matches",
        "hidden": false,
        "id": "text2004428150",
        "max": 0,
        "min": 0,
        "name": "group_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_485997869",
    "indexes": [],
    "listRule": null,
    "name": "fixtures",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": null
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_485997869");

  return app.delete(collection);
})
