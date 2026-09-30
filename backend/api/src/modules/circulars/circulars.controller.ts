import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { CircularsService } from "./circulars.service";
import { MAX_UPLOAD_BYTES } from "./circular-store.service";
import { ReferenceDetectorService } from "./reference-detector.service";
import { UploadCircularDto } from "./dto/upload-circular.dto";

@ApiTags("circulars")
@Controller("circulars")
export class CircularsController {
  constructor(
    private circulars: CircularsService,
    private detector: ReferenceDetectorService,
  ) {}

  @Post("upload")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File a circular document against a producer and round" })
  // Held in memory rather than a temp file: the largest circular in a round is
  // under 2MB, and the store writes it straight through to disk.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Body() dto: UploadCircularDto,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException("Attach the circular as `file`.");
    return this.circulars.upload(dto, file, req.user?.id);
  }

  @Post("bulk-upload")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "File a whole round's circulars at once; producer, date, kind and reference are read from each" })
  @UseInterceptors(FilesInterceptor("files", 30, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  bulkUpload(@UploadedFiles() files: { buffer: Buffer; originalname?: string }[] | undefined, @Req() req: any) {
    return this.circulars.bulkUpload(files ?? [], req.user?.id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a filed circular that has not been published (with its unpublished draft and documents)" })
  deleteFiled(@Param("id") id: string, @Req() req: any) {
    return this.circulars.deleteFiled(id, req.user?.id);
  }

  @Post("detect-reference")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Read a circular's own reference number out of the document",
  })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async detectReference(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException("Attach the circular as `file`.");
    // Never fails the caller: this only prefills a field, and the person
    // filing can always type it themselves.
    return this.detector.detect(file.buffer);
  }

  @Post(":id/extract")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({
    summary: "Attach an extracted reading to a filed circular and draft it for review",
  })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  extract(
    @Param("id") id: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string } | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException("Attach the extract as `file`.");
    return this.circulars.attachExtract(id, file, req.user?.id);
  }

  @Get(":id/source")
  @ApiOperation({ summary: "Download the stored source document for one circular" })
  async source(@Param("id") id: string, @Res() res: Response) {
    const { data, filename } = await this.circulars.source(id);
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    res.send(data);
  }

  @Get()
  @ApiOperation({ summary: "All price and freight circulars, newest first" })
  list(@Query("kind") kind?: "price" | "freight") {
    return this.circulars.list(kind);
  }

  @Get("rounds")
  @ApiOperation({ summary: "Effective dates available to price against" })
  rounds() {
    return this.circulars.rounds();
  }

  @Get("diff")
  @ApiOperation({ summary: "What changed for one producer between two rounds" })
  diff(
    @Query("producer") producer: string,
    @Query("from") from: string,
    @Query("to") to: string,
  ) {
    return this.circulars.diff(producer, new Date(from), new Date(to));
  }

  @Get(":id")
  @ApiOperation({ summary: "One circular and a sample of its entries" })
  detail(@Param("id") id: string) {
    return this.circulars.detail(id);
  }

  @Post(":id/publish")
  @ApiOperation({ summary: "Make a circular active and supersede its predecessor" })
  publish(@Param("id") id: string) {
    return this.circulars.publish(id);
  }
}
