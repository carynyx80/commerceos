import { Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Auth } from "../../common/auth";
import { badRequest } from "../../common/errors";

/**
 * Product media. Development stores files on local disk (UPLOAD_DIR). Production must set
 * an object store (see docs/deployment.md); local disk is not durable on hosted platforms.
 */
const DIR = resolve(process.env.UPLOAD_DIR ?? "../../.uploads");
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// Magic bytes so a renamed file can't masquerade as an image.
const SIG: Record<string, number[]> = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };

@Controller("uploads")
export class UploadsController {
  @Post()
  @Auth()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@UploadedFile() file?: { mimetype: string; buffer: Buffer; size: number }) {
    if (!file) throw badRequest("NO_FILE", "Attach an image file.");
    const ext = TYPES[file.mimetype];
    if (!ext || !SIG[ext].every((b, i) => file.buffer[i] === b)) throw badRequest("BAD_TYPE", "Only JPEG, PNG or WebP images are allowed.");
    mkdirSync(DIR, { recursive: true });
    const name = `${createHash("sha256").update(file.buffer).digest("hex").slice(0, 32)}.${ext}`;
    writeFileSync(resolve(DIR, name), file.buffer);
    const base = process.env.PUBLIC_API_URL ?? "/api";
    return { url: `${base}/uploads/${name}` };
  }

  @Get(":name")
  serve(@Param("name") name: string, @Res() res: Response) {
    if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) throw new NotFoundException();
    const p = resolve(DIR, name);
    if (!existsSync(p)) throw new NotFoundException();
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(p);
  }
}
