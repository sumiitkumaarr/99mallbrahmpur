const path = require("node:path");
const express = require("express");

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.static(__dirname));
app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(port, () => {
  console.log(`99 Mall running at http://localhost:${port}`);
});
