import express from 'express';  
import bodyParser from 'body-parser';
import fetch from 'node-fetch';

//id = xv03o02gyy0j5dw85nmwiruuh6yg5c
//secret = a608dbbg8bayo1an018t9j506numlp
const clientId = 'xv03o02gyy0j5dw85nmwiruuh6yg5c';
const clientSecret = 'a608dbbg8bayo1an018t9j506numlp';

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
const PORT = process.env.PORT || 3000;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));




// For home page
app.get("/", (req, res) => {
  res.render("home.ejs", { page: "home" });
});

// For about page
app.get("/about", (req, res) => {
  res.render("about.ejs", { page: "about" });
});

// For contact page
app.get("/contact", (req, res) => {
  res.render("contact.ejs", { page: "contact" });
});

// For games page
app.get("/games", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 49;
  const search = req.query.search || "";
  const games = await fetchGames(page, limit, search);
  res.render("games.ejs", { games, page, search: "games" });
});


app.listen(PORT, () => {
  console.log("Server running on http://localhost:3000");
});