import express from 'express';  
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.render("home.ejs");
});

app.get("/games", (req, res) => {
  res.render("games.ejs");
});

app.listen(PORT, () => {
  console.log("Server running on http://localhost:3000");
});