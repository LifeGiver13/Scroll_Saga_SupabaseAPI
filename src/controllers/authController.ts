import type { Request, Response } from 'express';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { prisma } from "../config/prisma.js";

import streamifier from "streamifier";
import cloudinary from "../config/cloudinary.js";
import { comparePassword, hashPassword } from '../utils/hash.js';
import { generateToken } from '../utils/jwt.js'; // Adjust path if necessary

// Helper to sanitize user object by removing passwordHash
function sanitizeUser(user: any) {
    if (!user) return user;
    const { passwordHash, ...safeUser } = user;
    return safeUser;
}

// req.params values can type as `string | string[]` (Express allows
// repeatable route segments), so we normalize to a single string here
// once, instead of repeating this in every function below.
function getParamId(req: Request): string | undefined {
    const raw = req.params.id;
    return Array.isArray(raw) ? raw[0] : raw;
}

export const registerUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            res.status(400).json({ error: "Email, username, and password are required" });
            return;
        }

        // 1. Check if a user with this email or username already exists
        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { email },
                    { username }
                ]
            }
        });

        if (existingUser) {
            const field = existingUser.email === email ? "Email" : "Username";
            res.status(400).json({ error: `${field} is already taken` });
            return;
        }


        // 2. Proceed with registration if email is free
        const passwordHash = await hashPassword(password);

        const newUser = await prisma.user.create({
            data: {
                email,
                username,
                passwordHash,
                role: Role.user,
                status: UserStatus.active
            },
        });

        const token = generateToken(newUser.id);

        res.status(201).json({
            message: "User registered successfully!",
            token,
            user: sanitizeUser(newUser)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Handles logging in an existing user
 */
export const loginUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            res.status(400).json({ error: "Username and password are required" });
            return;
        }

        // Find user by username
        const user = await prisma.user.findUnique({
            where: { username }
        });

        if (!user) {
            res.status(401).json({ error: "Invalid username or password" });
            return;
        }

        const passwordMatches = await comparePassword(password, user.passwordHash);

        if (!passwordMatches) {
            res.status(401).json({ error: "Invalid username or password" });
            return;
        }

        // Generate token upon verified authentication
        const token = generateToken(user.id);

        res.status(200).json({
            message: "Login successful!",
            token,
            user: sanitizeUser(user)
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const uploadProfilePicture = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({
                error: "User id is required in the URL"
            });
            return;
        }

        if (!req.file) {
            res.status(400).json({
                error: "No image uploaded"
            });
            return;
        }

        const result = await new Promise<any>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: "avatars"
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );

            streamifier.createReadStream(req.file!.buffer)
                .pipe(stream);
        });

        const user = await prisma.user.update({
            where: {
                id
            },
            data: {
                avatarUrl: result.secure_url
            }
        });

        res.json(sanitizeUser(user));

    } catch (err: any) {
        res.status(500).json({
            error: err.message
        });
    }
};

export const changePassword = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({
                error: "User id is required in the URL"
            });
            return;
        }

        const {
            newPassword,
            confirmPassword
        } = req.body;

        if (!newPassword || !confirmPassword) {
            res.status(400).json({
                error: "New Password and Confirm Password are required"
            });
            return;
        }

        if (newPassword !== confirmPassword) {
            res.status(400).json({
                error: "New passwords do not match"
            });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id }
        });

        if (!user) {
            res.status(404).json({
                error: "User not found"
            });
            return;
        }

        const hash = await hashPassword(newPassword);

        await prisma.user.update({
            where: { id },
            data: {
                passwordHash: hash
            }
        });

        res.json({
            message: "Password changed successfully."
        });

    } catch (error: any) {
        res.status(500).json({
            error: error.message
        });
    }
};

export const updateUser = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({
                error: "User id is required in the URL"
            });
            return;
        }

        const {
            username,
            email,
            bio
        } = req.body;

        // 1. Check if the new username or email is already taken by ANOTHER user
        if (email || username) {
            const conflictingUser = await prisma.user.findFirst({
                where: {
                    id: { not: id }, // Exclude the current user making the update
                    OR: [
                        ...(email ? [{ email }] : []),
                        ...(username ? [{ username }] : [])
                    ]
                }
            });

            if (conflictingUser) {
                const field = conflictingUser.email === email ? "Email" : "Username";
                res.status(400).json({ error: `${field} is already taken by another user` });
                return;
            }
        }

        // 2. If valid, proceed with update
        const user = await prisma.user.update({
            where: {
                id
            },
            data: {
                username,
                email,
                bio
            }
        });

        res.json(sanitizeUser(user));

    } catch (error: any) {
        res.status(500).json({
            error: error.message
        });
    }
};

export const deleteUser = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const id = getParamId(req);

        if (!id) {
            res.status(400).json({
                error: "User id is required in the URL"
            });
            return;
        }

        await prisma.user.delete({
            where: {
                id
            }
        });

        res.json({
            message: "User deleted."
        });

    } catch (error: any) {
        res.status(500).json({
            error: error.message
        });
    }
};
