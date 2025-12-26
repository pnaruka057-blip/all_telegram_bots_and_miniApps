require('dotenv').config();
const { Markup, Scenes, session } = require('telegraf');
const join_telegram_channel = require('./actions/join_telegram_channel');
const check_channel_joined = require('./middleware/check_channel_joined');
const addMovies = require('./actions/addMovies');
const addShows = require('./actions/addShows');
const addMovieWizard = require('./Scenes/add_movie_scenes');
const addShowWizard = require('./Scenes/add_show_scenes');
const editMovies = require('./actions/edit_movies');
const editShows = require('./actions/edit_shows');
const editMovieWizard = require('./Scenes/edit_movie_scenes');
const editShowWizard = require('./Scenes/edit_show_scenes');
const updateMovieWizard = require('./Scenes/update_movie_db_scenes');
const updateShowWizard = require('./Scenes/update_show_db_scense');
const findMovies = require('./actions/findMovies');
const findShows = require('./actions/findShows');
const start_message = require('./helpers/start_message');
const user_menu = require('./actions/user_menu')
const admin_menu = require('./actions/admin_menu')
const find_movies_shows_in_group = require('./actions/group_message_listner')
const cron_jobs = require('./helpers/cron_jobs')

module.exports = (bot) => {
    // Middleware to handle sessions and scenes
    bot.use(session());
    const stage = new Scenes.Stage([addMovieWizard, editMovieWizard, updateMovieWizard, addShowWizard, editShowWizard, updateShowWizard]);
    bot.use(stage.middleware());

    // Start command handler
    bot.start(async (ctx) => {
        if (ctx.chat.type === 'private') {
            await start_message(bot, ctx)
        }
    });

    // action handlers
    join_telegram_channel(bot);
    addMovies(bot);
    addShows(bot);
    editShows(bot);
    editMovies(bot);
    admin_menu(bot);
    find_movies_shows_in_group(bot);

    // Middleware to check if user has joined the channel
    check_channel_joined(bot, Markup);

    findMovies(bot);
    user_menu(bot);
    findShows(bot);

    // cron for shows
    cron_jobs(bot)
}