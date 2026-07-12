import { Router } from 'express';
import { registerUser, loginUser, uploadProfilePicture, updateUser, changePassword, deleteUser } from '../controllers/authController.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.post('/auth/register', registerUser);
router.post('/auth/login', loginUser);


router.put("/user/update/:id", updateUser);

router.put("/user/change-password/:id", changePassword);

router.put(
    "/user/upload-avatar/:id",
    upload.single("avatar"),
    uploadProfilePicture
);

router.delete("/delete/:id", deleteUser);

export default router;