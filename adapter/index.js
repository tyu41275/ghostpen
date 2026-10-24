// The adapter module chatter loads (`<checkout>/adapter`): the built adapter plus its smoke cases
// (smoke/cases.json, which chatter requires in staging and production). Build first: `npm run build`.
module.exports = require("./dist/adapter/index.js");
