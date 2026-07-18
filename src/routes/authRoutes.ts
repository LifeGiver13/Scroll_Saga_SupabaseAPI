import { Router } from 'express';
import {
    registerUser,
    loginUser,
    uploadProfilePicture,
    updateUser,
    changePassword,
    deleteUser,
    getUsers,
    getUserById
} from '../controllers/authController.js';
import {
    createNovel,
    getNovels,
    getNovelById,
    updateNovel,
    deleteNovel,
    uploadNovelCover,
    attachGenreToNovel,
    removeGenreFromNovel,
    attachTagToNovel,
    removeTagFromNovel
} from '../controllers/novelController.js';
import {
    createAuthor,
    getAuthors,
    getAuthorById,
    getAuthorByUserId,
    updateAuthor,
    deleteAuthor
} from '../controllers/authorController.js';
import {
    getGenres,
    createGenre,
    deleteGenre
} from '../controllers/genreController.js';
import {
    getTags,
    createTag,
    deleteTag
} from '../controllers/tagController.js';

import {
    createChapter,
    getChaptersByNovel,
    getChapterById,
    updateChapter,
    deleteChapter,
    publishChapter,
    grantChapterAccess,
    checkChapterAccess
} from "../controllers/chaptersController.js";

import { upload } from '../middleware/upload.js';

const router = Router();

// ======================= AUTH =======================
router.post('/auth/register', registerUser);
router.post('/auth/login', loginUser);

// ================= USER ACCOUNT =====================
router.get("/users", getUsers);
router.get("/users/:id", getUserById);


router.put("/user/update/:id", updateUser);
router.put("/user/change-password/:id", changePassword);
router.put(
    "/user/upload-avatar/:id",
    upload.single("avatar"),
    uploadProfilePicture
);
router.delete("/delete/:id", deleteUser);

// ====================== AUTHORS ======================
router.post("/authors", createAuthor);
router.get("/authors", getAuthors);
router.get("/authors/:id", getAuthorById);
router.get("/authors/user/:userId", getAuthorByUserId);
router.put("/authors/:id", updateAuthor);
router.delete("/authors/:id", deleteAuthor);

// ======================= NOVELS ======================
router.post("/novels", createNovel);
router.get("/novels", getNovels);
router.get("/novels/:id", getNovelById);
router.put("/novels/:id", updateNovel);
router.delete("/novels/:id", deleteNovel);
router.put(
    "/novels/:id/cover",
    upload.single("cover"),
    uploadNovelCover
);
router.post("/novels/:id/genres", attachGenreToNovel);
router.delete("/novels/:id/genres/:genreId", removeGenreFromNovel);
router.post("/novels/:id/tags", attachTagToNovel);
router.delete("/novels/:id/tags/:tagId", removeTagFromNovel);

// ================= GENRES & TAGS =====================
router.get("/genres", getGenres);
router.post("/genres", createGenre);
router.delete("/genres/:id", deleteGenre);

router.get("/tags", getTags);
router.post("/tags", createTag);
router.delete("/tags/:id", deleteTag);


// ====================== CHAPTERS ======================

// CRUD
router.post("/novels/:novelId/chapters", createChapter);
router.get("/novels/:novelId/chapters", getChaptersByNovel);

router.get("/chapters/:id", getChapterById);
router.put("/chapters/:id", updateChapter);
router.delete("/chapters/:id", deleteChapter);

// Publishing
router.put("/chapters/:id/publish", publishChapter);

// Access Management
router.post("/chapters/:id/access", grantChapterAccess);
router.get("/chapters/:id/access/:userId", checkChapterAccess);


export default router;