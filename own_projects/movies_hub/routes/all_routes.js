const express = require('express')
const app = express()
const upload = require('../../../globle_helper/multer_file_upload_mongoDB')
const path = require('path')
const expressEjsLayouts = require('express-ejs-layouts');
const shows_module = require('../model/shows_module');
const movies_module = require('../model/movies_module');
let movies_hub_token = process.env.MOVIES_HUB_TOKEN
const developer_telegram_username = process.env.DEVELOPER_TELEGRAM_USERNAME

app.use(express.static(path.join(__dirname, '..', "public")))
app.use(expressEjsLayouts);

app.set('view engine', 'ejs')
app.set('views', path.resolve(__dirname, '..', 'public', 'views'));
app.set('layout', path.resolve(__dirname, '..', 'public', 'views', 'layout'));

app.get("/movies-hub", async (req, res) => {
    try {
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
            currentPath: '/movies-hub',
            movies,
            shows,
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

app.get('/promox/unlock/groups', async (req, res) => {
    try {
        const { user_id } = req.cookies;
        if (!user_id) return res.status(401).json({ success: false, msg: "Unauthorized: No user_id cookie" });

        const user = await user_module.findOneAndUpdate(
            { user_id },
            { is_group_page_locked_date: new Date() },
            { new: true }
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found" });
        }

        return res.json({ success: true, msg: "Group page unlocked" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: "Server error" });
    }
});

app.get('/promox/post', (req, res) => {
    res.render('pages/post', {
        currentPath: '/post', current_url: process.env.GLOBLE_DOMAIN,
        developer_telegram_username,
        token: promoX_token
    })
})

app.post("/promox/post", upload.single("logo"), async (req, res) => {
    try {
        const { user_id } = req.cookies;
        if (!user_id) return res.status(401).json({ message: "Unauthorized: Login required" });

        // Find user to verify
        const user = await user_module.findOne({ user_id }).lean();
        if (!user) return res.status(401).json({ message: "User not found or unauthorized" });

        const { type, name, username, category, description } = req.body;

        if (!type || !name || !username || !category) {
            return res.status(200).json({ message: "Missing required fields" });
        }

        // Step 1: Telegram username verification
        const checkResult = await checkTelegramUsername(username);
        if (!checkResult.valid) {
            return res.status(200).json({ success: false, msg: `Invalid Telegram username: ${checkResult.reason}` });
        }

        // Step 2: Type matching verification
        if (type === "group" && !["supergroup", "group"].includes(checkResult.type)) {
            return res.status(200).json({ success: false, msg: "This username does not belong to a group" });
        }
        if (type === "channel" && checkResult.type !== "channel") {
            return res.status(200).json({ success: false, msg: "This username does not belong to a channel" });
        }

        // Username duplicate check
        let existing;
        if (type === "group") {
            existing = await user_groups_module.findOne({ username: username.trim().toLowerCase() }).lean();
        } else if (type === "channel") {
            existing = await user_channels_module.findOne({ username: username.trim().toLowerCase() }).lean();
        } else {
            return res.status(200).json({ success: false, msg: "Invalid type selected" });
        }

        if (existing) {
            return res.status(200).json({ success: false, msg: "Username already taken. Please choose another." });
        }

        // Prepare common data
        const data = {
            userDB_id: user._id,
            username: username.trim().toLowerCase(),
            category: category.trim(),
            short_description: description ? description.trim() : "",
            auto_delete_time: new Date(Date.now() + 2 * 60 * 60 * 1000), // auto delete after 2 Hours
        };

        // Add logo buffer if uploaded
        if (req.file) {
            data.logo = {
                data: req.file.buffer,
                contentType: req.file.mimetype
            };
        }

        let savedDoc;
        if (type === "group") {
            savedDoc = await user_groups_module.create({
                ...data,
                group_name: name.trim(),
            });
        } else if (type === "channel") {
            savedDoc = await user_channels_module.create({
                ...data,
                channel_name: name.trim(),
            });
        }

        return res.status(201).json({ msg: `${type} created successfully`, data: savedDoc });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ msg: "Server error", error: err.message });
    }
});

app.get('/promox/profile', async (req, res) => {
    try {
        const { user_id } = req.cookies;

        if (!user_id) {
            return res.status(401).render('pages/error', {
                message: "Unauthorized: Please login to view your profile"
            });
        }

        const user = await user_module.findOne({ user_id }).lean();
        if (!user) {
            return res.status(404).render('pages/error', {
                message: "User not found"
            });
        }

        // Fetch user channels & groups
        const [channels, groups] = await Promise.all([
            user_channels_module.find({ userDB_id: user._id }).lean(),
            user_groups_module.find({ userDB_id: user._id }).lean()
        ]);

        // Total post counts
        const totalStats = {
            channels: channels.length,
            groups: groups.length
        };

        // Default lock value
        let is_profile_page_locked = true;

        if (user && user.is_profile_page_locked) {
            let lockedDate = new Date(user.is_profile_page_locked);
            let now = new Date();

            // difference in hours
            let diffHours = (now - lockedDate) / (1000 * 60 * 60);

            if (diffHours <= 24) {
                is_profile_page_locked = false; // Lock khol do
            }
        }

        res.render('pages/profile', {
            currentPath: '/profile',
            user,
            totalStats,
            channelsList: channels,
            groupsList: groups,
            is_profile_page_locked,
            developer_telegram_username,
            current_url: process.env.GLOBLE_DOMAIN,
            token: promoX_token
        });

    } catch (err) {
        console.error("Error loading profile:", err);
        res.status(500).render('pages/error', {
            message: "Server error while loading profile"
        });
    }
});

app.get('/promox/unlock/profile', async (req, res) => {
    try {
        const { user_id } = req.cookies;

        if (!user_id) return res.status(401).json({ success: false, msg: "Unauthorized: No user_id cookie" });

        const user = await user_module.findOneAndUpdate(
            { user_id },
            { is_profile_page_locked: new Date() },
            { new: true }
        ).lean();

        if (!user) {
            return res.status(404).json({ success: false, msg: "User not found" });
        }

        return res.json({ success: true, msg: "Channel page unlocked" });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, msg: "Server error" });
    }
});

app.post('/promox/deletepost', async (req, res) => {
    try {
        const { id } = req.body;
        const { user_id } = req.cookies;

        if (!user_id) {
            return res.status(401).json({ success: false, msg: "Unauthorized: Login required" });
        }

        const user = await user_module.findOne({ user_id }).lean();
        if (!user) {
            return res.status(401).json({ success: false, msg: "User not found" });
        }

        // Try deleting from channels or groups
        let deleted = await user_channels_module.findOneAndDelete({ _id: id, userDB_id: user._id });
        if (!deleted) {
            deleted = await user_groups_module.findOneAndDelete({ _id: id, userDB_id: user._id });
        }

        if (!deleted) {
            return res.status(404).json({ success: false, msg: "Post not found or not owned by you" });
        }

        return res.json({ success: true, msg: "Post deleted successfully" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: "Server error", error: err.message });
    }
});

app.post('/promox/increaseautodelete', async (req, res) => {
    try {
        const { id } = req.body;
        const { user_id } = req.cookies;

        if (!user_id) {
            return res.status(401).json({ success: false, msg: "Unauthorized: Login required" });
        }

        const user = await user_module.findOne({ user_id }).lean();
        if (!user) {
            return res.status(401).json({ success: false, msg: "User not found" });
        }

        // Pehle channel me check karo
        let post = await user_channels_module.findOne({ _id: id, userDB_id: user._id });
        if (!post) {
            post = await user_groups_module.findOne({ _id: id, userDB_id: user._id });
        }

        if (!post) {
            return res.status(404).json({ success: false, msg: "Post not found or not owned by you" });
        }

        // Auto delete time +1 hours
        post.auto_delete_time = new Date(post.auto_delete_time.getTime() + (1 * 60 * 60 * 1000));
        await post.save();

        return res.json({ success: true, msg: "Auto delete time increased by 24 hours" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: "Server error", error: err.message });
    }
});

module.exports = app