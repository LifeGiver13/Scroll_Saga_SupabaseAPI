import type { Request, Response } from 'express';
import { PrismaClient, Role, UserStatus } from '@prisma/client';

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// 1. Set up a connection pool using your transaction-mode string
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// 2. Initialize the Prisma Pg driver adapter
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Handles registering a new user
 */
export const registerUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            res.status(400).json({ error: "Email, username, and password are required" });
            return;
        }

        const newUser = await prisma.user.create({
            data: {
                email,
                username,
                passwordHash: password, // Note: Hash this with bcrypt/argon2 in production!
                role: Role.user,
                status: UserStatus.active
            },
        });

        res.status(201).json({ message: "User registered successfully!", user: newUser });
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

        if (!user || user.passwordHash !== password) {
            res.status(401).json({ error: "Invalid username or password" });
            return;
        }

        res.status(200).json({ message: "Login successful!", userId: user.id });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};