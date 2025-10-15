import express from 'express';  
import bodyParser from 'body-parser';
import env from 'dotenv';
import pg from 'pg';
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import GoogleStrategy from "passport-google-oauth20";

env.config();
const app = express();
app.set("view engine", "ejs");
const PORT = process.env.PORT;
const saltRounds = 10;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

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
  try {
    const token = await getAccessToken();
    const offset = (page - 1) * limit;
    let query = `fields name,cover.url,first_release_date,rating;
    limit ${limit}; offset ${offset};`;

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
  } catch (error) {
    console.error("Error fetching games:", error);
    return [];
  }
} 


async function fetchGameById(gameId) {
  const token = await getAccessToken();

  const query = `
    fields id, name, summary, storyline, rating, total_rating, rating_count,
    first_release_date, genres.name, cover.url, screenshots.url,
    platforms.name, involved_companies.company.name;
    where id = ${gameId};
  `;
  console.log(query) 
  const response = await fetch("https://api.igdb.com/v4/games", {
    method: "POST",
    headers: {
      "Client-ID": clientId,
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    },
    body: query
  });


  // ✅ this is safe inside async function
  const data = await response.json();
  return data[0] || null;
};


app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});



app.get("/", (req, res) => {
  res.render("home.ejs", { page: "home" });
});


app.get("/games", async (req, res) => {
  const gamespage = parseInt(req.query.page) || 1;
  const limit = 49;
  const search = req.query.search || "";
  const games = await fetchGames(gamespage, limit, search);
  res.render("games.ejs", { games, gamespage, page: "games", search});
});


app.get("/game/:id", async (req, res) => {
  const gameId = req.params.id;
  console.log("➡ Fetching game with ID:", gameId);

  const game = await fetchGameById(gameId);

  if (!game) {
    console.log("No game found for ID:", gameId);
    return res.status(404).send("Game not found");
  }

  let inLibrary = false;
  if (req.isAuthenticated()) {
    const result = await db.query(
      "SELECT * FROM user_games WHERE user_id = $1 AND game_id = $2",
      [req.user.id, gameId]
    );
    inLibrary = result.rows.length > 0;
  }

  console.log("Game found:", game.name, "| In library:", inLibrary);

  res.render("game.ejs", { game, page: "game", inLibrary });
});



app.get("/profile", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const result = await db.query(
      "SELECT * FROM user_games WHERE user_id = $1 ORDER BY id DESC",
      [req.user.id]
    );
    res.render("profile.ejs", { page: "profile", games: result.rows });
  } catch (err) {
    console.error("Error loading profile:", err);
    res.status(500).send("Error loading profile");
  }
});


app.post("/library/add", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  let { game_id, game_name, cover_url } = req.body;

  if (cover_url) {
  cover_url = cover_url
    .replace("t_thumb", "t_cover_big");
}

  const user_id = req.user.id;

  try {
    await db.query(
      `INSERT INTO user_games (user_id, game_id, game_name, cover_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, game_id) DO NOTHING`,
      [user_id, game_id, game_name, cover_url]
    );
    res.redirect("/profile");
  } catch (err) {
    console.error("Error adding game:", err);
    res.status(500).send("Error adding game to library");
  }
});

app.post("/library/remove", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const { game_id } = req.body;
  const user_id = req.user.id;

  try {
    await db.query(
      "DELETE FROM user_games WHERE user_id = $1 AND game_id = $2",
      [user_id, game_id]
    );
    res.redirect("/profile");
  } catch (err) {
    console.error("Error removing game:", err);
    res.status(500).send("Error removing game");
  }
});



app.get("/register", (req, res) => {
  res.render("register.ejs", { page: "register" });
});

app.get("/login", (req, res) => {
  res.render("login.ejs", { page: "login" });
}); 


app.post("/register", async (req, res) => {
  const { username, email, password, repeatPassword } = req.body;

  if (password !== repeatPassword) {
  return res.render("register.ejs", { page: "register", message: "Passwords do not match" });
  }

  try {
    const existing = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.render("register.ejs", { page: "register", message: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, saltRounds);
    await db.query("INSERT INTO users (username, email, password) VALUES ($1, $2, $3)", [
      username,
      email,
      hashed,
    ]);

    
    res.redirect("/login");
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).send("Internal Server Error");
  }
});

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);


app.get("/logout", (req, res) => {
  req.logout(() => {
    res.redirect("/");
  });
});

// Start Google login
app.get(
  "/auth/google",
  passport.authenticate("google", { 
    scope: ["profile", "email"] })
);

// Google callback
app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login",
  })
);



passport.use(
  new LocalStrategy(
    { usernameField: "username", passwordField: "password" },
    async (username, password, done) => {
      try {
        const result = await db.query("SELECT * FROM users WHERE username = $1", [username]);
        if (result.rows.length === 0) return done(null, false, { message: "User not found" });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return done(null, false, { message: "Incorrect password" });

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? "https://your-domain.com/auth/google/callback"
          : "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if the user already exists
        const result = await db.query("SELECT * FROM users WHERE google_id = $1", [profile.id]);

        if (result.rows.length > 0) {
          // User exists
          return done(null, result.rows[0]);
        } else {
          // Create new user
          const newUser = await db.query(
            "INSERT INTO users (username, email, google_id) VALUES ($1, $2, $3) RETURNING *",
            [profile.displayName, profile.emails?.[0]?.value, profile.id]
          );
          return done(null, newUser.rows[0]);
        }
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user.id);
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

app.listen(PORT, () => {
  console.log("Server running on http://localhost:3000");
});