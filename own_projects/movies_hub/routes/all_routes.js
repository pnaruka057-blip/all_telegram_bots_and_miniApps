const express = require('express')
const app = express()
const upload = require('../../../globle_helper/multer_file_upload_mongoDB')
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const shows_module = require('../model/shows_module');
const movies_module = require('../model/movies_module');
const users_module = require('../model/users_module');
const other_modules = require('../model/other_module');
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME

app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);

app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));

app.get("/movies-hub", async (req, res) => {
    try {
        const user_id = req.query.userId
        const currentPage = 1;
        const limit = 12;

        // Movies ke liye pagination
        const totalMovies = await movies_module.countDocuments();
        const totalMoviePages = Math.ceil(totalMovies / limit);

        const movies = await movies_module.find()
            .skip((currentPage - 1) * limit)
            .limit(limit);

        // Shows ke liye pagination (agar alag se chahiye)
        const totalShows = await shows_module.countDocuments();
        const totalShowPages = Math.ceil(totalShows / limit);

        const shows = await shows_module.find()
            .skip((currentPage - 1) * limit)
            .limit(limit);

        res.render("pages/home", {
            currentPath: '/',
            movies,
            shows,
            user_id,
            currentPage,
            totalMoviePages,
            totalShowPages,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });

    } catch (error) {
        console.error("Error loading hub:", error);
        res.status(500).send("Server Error");
    }
});

app.get('/movies-hub/search', async (req, res) => {
    try {
        // Query params
        const type = req.query.type || 'movie'; // movie ya show
        const page = parseInt(req.query.page) || 1;
        const limit = 12;
        const search = req.query.search ? req.query.search.trim() : '';
        const category = req.query.category && req.query.category !== 'All'
            ? req.query.category.trim()
            : '';

        let filter = {};

        // Title search filter
        if (search) {
            filter.title = { $regex: search, $options: 'i' };
        }

        // Category filter
        if (category) {
            filter.category = { $regex: category, $options: 'i' };
        }

        // Correct Model select karo
        const Model = type === 'show' ? shows_module : movies_module;

        // Total items count
        const totalItems = await Model.countDocuments(filter);
        const totalPages = Math.ceil(totalItems / limit);

        // Pagination + sorting
        const items = await Model.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        // JSON Response
        res.json({
            success: true,
            currentPage: page,
            totalPages,
            totalItems,
            type,
            search,
            category,
            movies: type === 'movie' ? items : [],
            shows: type === 'show' ? items : []
        });

    } catch (err) {
        console.error("Error fetching movies/shows:", err);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});

app.post("/movies-hub/verify-telegram-user", async (req, res) => {
    try {
        console.log(req.body);
        let { id, first_name, last_name, username, allows_write_to_pm, photo_url } = req.body;
        console.log("Verified Telegram User:", req.body);

        // Pehle check karo user already exist karta hai ya nahi
        const existingUser = await user_module.findOne({ user_id: id });

        if (!existingUser) {
            // User nahi hai, create karo
            await new user_module({
                user_id: id,
                first_name,
                last_name,
                username,
                allows_write_to_pm,
                photo_url
            }).save();
            console.log("New user created:", id);
        } else {
            console.log("User already exists:", id);
        }
        res.cookie("user_id", id);
        res.json({
            success: true,
            msg: "User verified successfully"
        });
    } catch (err) {
        console.error("Verification failed", err);
        res.status(500).send("Verification failed");
    }
});

app.get('/movies-hub/find-movies/:movie_query', async (req, res) => {
    try {
        const currentPage = 1;
        const limit = 12;
        const searchQuery = req.params.movie_query;
        const user_id = req.query.userId

        // Regex based search (case-insensitive)
        const movieFilter = { title: { $regex: searchQuery, $options: 'i' } };

        // Movies ke liye pagination
        const totalMovies = await movies_module.countDocuments(movieFilter);
        const totalMoviePages = Math.ceil(totalMovies / limit);

        const movies = await movies_module.find(movieFilter)
            .skip((currentPage - 1) * limit)
            .limit(limit);

        res.render("pages/find_movies", {
            currentPath: `/movies-hub/find-movies`,
            movies,
            user_id,
            currentPage,
            totalMoviePages,
            movie_query: searchQuery,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });
    } catch (error) {
        console.error("Error finding movies:", error);
        res.status(500).send("Server Error");
    }
});

app.get('/movies-hub/find-shows/:show_query', async (req, res) => {
    try {
        const currentPage = 1;
        const limit = 12;
        const searchQuery = req.params.show_query;
        const user_id = req.query.userId

        // Regex based search (case-insensitive)
        const showFilter = { title: { $regex: searchQuery, $options: 'i' } };

        // Shows ke liye pagination
        const totalShows = await shows_module.countDocuments(showFilter);
        const totalShowPages = Math.ceil(totalShows / limit);

        const shows = await shows_module.find(showFilter)
            .skip((currentPage - 1) * limit)
            .limit(limit);

        res.render("pages/find_shows", {
            currentPath: `/movies-hub/find-shows`,
            shows,
            user_id,
            currentPage,
            totalShowPages,
            show_query: searchQuery,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });
    } catch (error) {
        console.error("Error finding shows:", error);
        res.status(500).send("Server Error");
    }
});

app.get('/movies-hub/send-request/:query', async (req, res) => {
    try {
        const query = req.params.query;
        const { movie, show, user_id } = req.query; // query params se values nikal lo

        // Type set karo (default null)
        let type = null;
        if (movie === "true") type = "movie";
        else if (show === "true") type = "show";

        // User document fetch karo (agar user_id diya gaya ho)
        let user = null;
        if (user_id) {
            user = await users_module.findOne({ user_id }).lean().select("name username profile_logo language");
        }

        res.render("pages/send_request", {
            currentPath: '/movies-hub/send-request',
            query,
            user_id,
            type, // movie/show
            user, // {name, username, profile_logo, language}
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });

    } catch (error) {
        console.error("Error rendering request page:", error);
        res.status(500).send("Server Error");
    }
});

app.get('/movies-hub/send-request', async (req, res) => {
    try {
        const user_id = req.query.userId
        const user = await users_module.findOne({ user_id }).lean().select("name username profile_logo language");
        res.render("pages/send_request", {
            currentPath: '/movies-hub/send-request',
            type: "",
            query: "",
            user,
            user_id,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });

    } catch (error) {
        console.error("Error rendering request page:", error);
        res.status(500).send("Server Error");
    }
});

app.post('/movies-hub/send-request', async (req, res) => {
    try {
        const { title, language, user_id, type } = req.body;

        if (!title || !language || !user_id || !type) {
            return res.status(400).json({ success: false, msg: "All fields are required." });
        }
        const user = await users_module.findOne({ user_id }).lean().select("_id");
        const newRequest = new other_modules({
            document_name: "request",
            title,
            language,
            type,
            status: false,
            requested_by: user._id
        });

        await newRequest.save();

        return res.status(201).json({
            success: true,
            message: "Request submitted successfully.",
            data: newRequest
        });

    } catch (error) {
        console.error("Error while saving request:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});

app.get('/movies-hub/profile', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Missing userId"
            });
        }

        const user = await users_module
            .findOne({ user_id: userId })
            .select("name username user_logo language user_id") 
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.render("pages/profile", {
            currentPath: '/movies-hub/profile',
            user,
            user_id: userId,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN || "",
            token: movies_hub_token
        });

    } catch (error) {
        console.error("Error while fetching profile:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});

module.exports = app