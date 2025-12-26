const express = require('express')
const app = express()
const upload = require('../../../globle_helper/multer_file_upload_mongoDB')
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const shows_module = require('../models/shows_module');
const movies_module = require('../models/movies_module');
const users_module = require('../models/users_module');
const other_modules = require('../models/other_module');
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME
const { Telegraf } = require('telegraf');


app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);


app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));


let movies_hub_bot;


if (process.env.MOVIES_HUB_NODE_ENV && process.env.MOVIES_HUB_NODE_ENV !== "development") {
    movies_hub_bot = new Telegraf(process.env.BOT_TOKEN_MOVIEHUB);
}


app.get("/movies-hub", async (req, res) => {
    try {
        const user_id = req.query.userId
        const fromId = req.query.fromId
        const currentPage = 1;
        const limit = 12;


        // Movies ke liye pagination
        const totalMovies = await movies_module.countDocuments();
        const totalMoviePages = Math.ceil(totalMovies / limit);


        const movies = await movies_module.aggregate([
            {
                $addFields: { releaseDateObj: { $dateFromString: { dateString: "$release_date", format: "%d %b %Y" } } }
            },
            { $sort: { download_count: -1, releaseDateObj: -1 } },
            { $skip: (currentPage - 1) * limit },
            { $limit: limit }
        ]);


        // Shows ke liye pagination (agar alag se chahiye)
        const totalShows = await shows_module.countDocuments();
        const totalShowPages = Math.ceil(totalShows / limit);


        const shows = await shows_module.aggregate([
            {
                $addFields: { releaseDateObj: { $dateFromString: { dateString: "$release_date", format: "%d %b %Y" } } }
            },
            { $sort: { download_count: -1, releaseDateObj: -1 } },
            { $skip: (currentPage - 1) * limit },
            { $limit: limit }
        ]);


        res.render("pages/home", {
            currentPath: '/',
            movies,
            fromId,
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
        const fromId = req.query.fromId ? req.query.fromId.trim() : '';
        const category = req.query.category && req.query.category !== 'All'
            ? req.query.category.trim()
            : '';


        // Correct Model select karo
        const Model = type === 'show' ? shows_module : movies_module;


        let filter = {};
        let items = [];
        let totalItems = 0;


        // ---------------- Step 1: Full regex search ----------------
        if (search) {
            filter.title = { $regex: search, $options: 'i' };
        }


        // Category filter
        if (category) {
            filter.category = { $regex: category, $options: 'i' };
        }


        // ---------------- Step 2: Aggregate with sort ----------------
        const aggregatePipeline = [
            { $match: filter },
            {
                $addFields: {
                    releaseDateObj: {
                        $dateFromString: { dateString: "$release_date", format: "%d %b %Y" }
                    }
                }
            },
            { $sort: { download_count: -1, releaseDateObj: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit }
        ];


        items = await Model.aggregate(aggregatePipeline);


        // Total count
        totalItems = await Model.countDocuments(filter);
        const totalPages = Math.ceil(totalItems / limit);


        // ---------------- Step 3: Word-to-word search (ignore numbers) if no result ----------------
        if (search && items.length === 0) {
            const words = search
                .split(/\s+/)
                .map(w => w.trim())
                .filter(w => /^[a-zA-Z]+$/.test(w));


            if (words.length > 0) {
                const regexWords = words.map(w => ({ title: { $regex: w, $options: "i" } }));


                filter = { $or: regexWords };
                if (category) {
                    filter = {
                        $and: [
                            { $or: regexWords },
                            { category: { $regex: category, $options: "i" } }
                        ]
                    };
                }


                // Re-run aggregate
                const aggregatePipeline2 = [
                    { $match: filter },
                    {
                        $addFields: {
                            releaseDateObj: {
                                $dateFromString: { dateString: "$release_date", format: "%d %b %Y" }
                            }
                        }
                    },
                    { $sort: { download_count: -1, releaseDateObj: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit }
                ];


                items = await Model.aggregate(aggregatePipeline2);
                totalItems = await Model.countDocuments(filter);
            }
        }


        // JSON Response
        res.json({
            success: true,
            currentPage: page,
            fromId,
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


app.get('/movies-hub/find-movies/:movie_query', async (req, res) => {
    try {
        const currentPage = 1;
        const limit = 12;
        const searchQuery = req.params.movie_query;
        const user_id = req.query.userId || req.query.user_id;
        const fromId = req.query.fromId;


        let movies = [];
        let totalMovies = 0;


        // ---------------- Step 1: Full regex search ----------------
        let movieFilter = { title: { $regex: searchQuery, $options: 'i' } };


        totalMovies = await movies_module.countDocuments(movieFilter);
        movies = await movies_module.find(movieFilter)
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();


        // ---------------- Step 2: Word-to-word search (ignore numbers) ----------------
        if (movies.length === 0) {
            const words = searchQuery
                .split(/\s+/)          // whitespace se split
                .map(w => w.trim())     // trim
                .filter(w => /^[a-zA-Z]+$/.test(w)); // sirf alphabets allow


            if (words.length > 0) {
                const regexWords = words.map(w => ({ title: { $regex: w, $options: "i" } }));


                movieFilter = { $or: regexWords };


                totalMovies = await movies_module.countDocuments(movieFilter);
                movies = await movies_module.find(movieFilter)
                    .skip((currentPage - 1) * limit)
                    .limit(limit)
                    .lean();
            }
        }


        const totalMoviePages = Math.ceil(totalMovies / limit);


        res.render("pages/find_movies", {
            currentPath: `/movies-hub/find-movies`,
            movies,
            fromId,
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


app.get('/movies-hub/movie_details', async (req, res) => {
    try {
        const { userId, movie_id, fromId } = req.query


        const movie_details = await movies_module.findOne({ _id: movie_id }).lean();


        res.render("pages/movies_details", {
            currentPath: `/movies-hub/find-movies`,
            user_id: userId,
            fromId,
            updatedMovieDetails: movie_details,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });
    } catch (error) {
        console.error("Error finding movies:", error);
        res.status(500).send("Server Error");
    }
});


app.get('/movies-hub/show_details', async (req, res) => {
    try {
        const { userId, show_id, fromId } = req.query


        const show_details = await shows_module.findOne({ _id: show_id }).lean();


        res.render("pages/shows_details", {
            currentPath: `/movies-hub/find-shows`,
            user_id: userId,
            fromId,
            updatedShowDetails: show_details,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: movies_hub_token
        });
    } catch (error) {
        console.error("Error finding shows:", error);
        res.status(500).send("Server Error");
    }
});


app.post('/movies-hub/get_shortlink', async (req, res) => {
    try {
        const { url, movie_id, show_id } = req.body;


        if (movie_id) {
            await movies_module.updateOne({ _id: movie_id }, { $inc: { download_count: 1 } });
        } else if (show_id) {
            await shows_module.updateOne({ _id: show_id }, { $inc: { download_count: 1 } });
        }


        return res.status(200).json({
            success: true,
            short_link: url
        });
    } catch (error) {
        console.error("Error short link:", error);
        res.status(500).json({
            success: false,
            message: "Server Error"
        });
    }
});


app.get('/movies-hub/find-shows/:show_query', async (req, res) => {
    try {
        const currentPage = 1;
        const limit = 12;
        const searchQuery = req.params.show_query;
        const fromId = req.params.fromId;
        const user_id = req.query.userId;


        let shows = [];
        let totalShows = 0;


        // ---------------- Step 1: Full regex search ----------------
        let showFilter = { title: { $regex: searchQuery, $options: "i" } };
        shows = await shows_module.find(showFilter)
            .skip((currentPage - 1) * limit)
            .limit(limit)
            .lean();


        totalShows = await shows_module.countDocuments(showFilter);


        // ---------------- Step 2: Word-to-word search (ignore numbers) ----------------
        if (shows.length === 0) {
            // query ko words me todho aur sirf alphabets rakho
            const words = searchQuery
                .split(/\s+/)          // whitespace se split
                .map(w => w.trim())     // trim
                .filter(w => /^[a-zA-Z]+$/.test(w)); // sirf alphabets allow (numeric ignore)


            if (words.length > 0) {
                const regexWords = words.map(w => ({ title: { $regex: w, $options: "i" } }));


                showFilter = { $or: regexWords };


                shows = await shows_module.find(showFilter)
                    .skip((currentPage - 1) * limit)
                    .limit(limit)
                    .lean();


                totalShows = await shows_module.countDocuments(showFilter);
            }
        }


        const totalShowPages = Math.ceil(totalShows / limit);


        res.render("pages/find_shows", {
            currentPath: `/movies-hub/find-shows`,
            shows,
            user_id,
            fromId,
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
        const { movie, show, user_id, fromId } = req.query; // query params se values nikal lo


        // Type set karo (default null)
        let type = null;
        if (movie === "true") type = "movie";
        else if (show === "true") type = "show";


        // User document fetch karo (agar user_id diya gaya ho)
        let user = null;
        if (user_id) {
            user = await users_module
                .findOne({ user_id: Number(user_id) })
                .lean()
                .select("first_name username language_code");

            // Backward compatible fields for old views
            if (user) {
                user.name = user.first_name;
                user.profile_logo = user.profile_logo || user.user_logo || null;
            }
        }


        res.render("pages/send_request", {
            currentPath: '/movies-hub/send-request',
            query,
            user_id,
            fromId,
            type, // movie/show
            user, // {first_name, username, language_code, name, profile_logo}
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

        const user = await users_module
            .findOne({ user_id: Number(user_id) })
            .lean()
            .select("first_name username language_code");

        // Backward compatible fields for old views
        if (user) {
            user.name = user.first_name;
            user.profile_logo = user.profile_logo || user.user_logo || null;
        }

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
        const user = await users_module.findOne({ user_id: Number(user_id) }).lean().select("_id");
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
            .findOne({ user_id: Number(userId) })
            .select("first_name username language_code user_id")
            .lean();


        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Backward compatible fields for old views
        user.name = user.first_name;


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


app.get('/movies-hub/view_requests', async (req, res) => {
    try {
        // Sirf pending requests leke aao
        const pending_requests = await other_modules.find({ document_name: "request" }).lean();


        res.render("pages/handle_requests", {
            pending_requests,   // only pending
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


app.post("/movies-hub/update_request", async (req, res) => {
    try {
        const { requestId, status, message } = req.body;


        if (!requestId) {
            return res.status(400).json({ success: false, message: "Request ID is required" });
        }


        const requestDoc = await other_modules.findById(requestId).populate('requested_by')


        if (!requestDoc) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }


        if (status === "true") {
            await other_modules.deleteOne({ _id: requestId }); // delete from DB
        }


        if (movies_hub_bot && message && requestDoc.requested_by.user_id) {
            try {
                await movies_hub_bot.telegram.sendMessage(requestDoc.requested_by.user_id.toString(), message);
            } catch (err) {
                console.error("❌ Failed to send Telegram message:", err.message);
            }
        }
        return res.json({ success: true, message: "Request updated successfully", completed: requestDoc });
    } catch (error) {
        console.error("Error in update_request:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});


module.exports = app;