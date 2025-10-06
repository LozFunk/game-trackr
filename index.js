import express from 'express';  
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import env from 'dotenv';

env.config();

const clientId = process.env.API_CLIENT_ID;
const clientSecret = process.env.API_CLIENT_SECRET;

async function getAccessToken() {
  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const data = await response.json();
  return data.access_token;
}

async function fetchGames(page = 1, limit = 49, search = "") {
  const token = await getAccessToken();
  const offset = (page - 1) * limit;
  let query = `fields name,cover.url,first_release_date; limit ${limit}; offset ${offset};`;
  if (search) {
    // IGDB search uses the 'search' keyword
    query = `search "${search}"; ` + query;
  }
  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
    body: query
  });
  const games = await response.json();
  return games; 
}

const app = express();
const PORT = process.env.PORT;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));




app.get("/", (req, res) => {
  res.render("home.ejs", { page: "home" });
});

app.get("/about", (req, res) => {
  res.render("about.ejs", { page: "about" });
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs", { page: "contact" });
});

app.get("/games", async (req, res) => {
  const gamespage = parseInt(req.query.page) || 1;
  const limit = 49;
  const search = req.query.search || "";
  const games = await fetchGames(gamespage, limit, search);
  res.render("games.ejs", { games, gamespage, page:"games", search: "games" });
});


app.listen(PORT, () => {
  console.log("Server running on http://localhost:3000");
});