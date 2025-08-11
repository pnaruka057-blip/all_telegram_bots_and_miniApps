const multer = require("multer");

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 },  // 200 KB max
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "image/jpeg" || file.mimetype === "image/jpg") {
            cb(null, true);
        } else {
            cb(new Error("Only JPG/JPEG images are allowed"));
        }
    }
});

module.exports = upload