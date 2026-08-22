import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";

import { ExcelExportService } from "./excel-export.service";
import { PdfExportService } from "./pdf-export.service";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_TYPE = "application/pdf";

function attachment(res: Response, filename: string, contentType: string) {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
}

/**
 * Excel and PDF are outputs generated on request from published/approved
 * data — never a store of files. A download is always the current state of
 * whatever it names: a superseded circular's own id still renders correctly,
 * because PriceEntry/FreightEntry rows are never edited after publish, only
 * superseded by a new circular.
 */
@ApiTags("exports")
@Controller("exports")
export class ExportsController {
  constructor(
    private excel: ExcelExportService,
    private pdf: PdfExportService,
  ) {}

  @Get("price-circular/:id/excel")
  @ApiOperation({ summary: "PriceCircular.xlsx for one published price circular" })
  async priceCircularExcel(@Param("id") id: string, @Res() res: Response) {
    const wb = await this.excel.priceCircularWorkbook(id);
    attachment(res, `PriceCircular-${id}.xlsx`, XLSX_TYPE);
    await wb.xlsx.write(res);
    res.end();
  }

  @Get("price-circular/:id/pdf")
  @ApiOperation({ summary: "PriceCircular.pdf for one published price circular" })
  async priceCircularPdf(@Param("id") id: string, @Res() res: Response) {
    const buf = await this.pdf.priceCircularPdf(id);
    attachment(res, `PriceCircular-${id}.pdf`, PDF_TYPE);
    res.send(buf);
  }

  @Get("freight-circular/:id/excel")
  @ApiOperation({ summary: "FreightCircular.xlsx for one published freight circular" })
  async freightCircularExcel(@Param("id") id: string, @Res() res: Response) {
    const wb = await this.excel.freightCircularWorkbook(id);
    attachment(res, `FreightCircular-${id}.xlsx`, XLSX_TYPE);
    await wb.xlsx.write(res);
    res.end();
  }

  @Get("freight-circular/:id/pdf")
  @ApiOperation({ summary: "FreightCircular.pdf for one published freight circular" })
  async freightCircularPdf(@Param("id") id: string, @Res() res: Response) {
    const buf = await this.pdf.freightCircularPdf(id);
    attachment(res, `FreightCircular-${id}.pdf`, PDF_TYPE);
    res.send(buf);
  }

  @Get("discount-circular/excel")
  @ApiOperation({ summary: "DiscountCircular.xlsx — GAIL's live terms vs every other producer's latest" })
  async discountCircularExcel(@Res() res: Response) {
    const wb = await this.excel.discountCircularWorkbook();
    attachment(res, "DiscountCircular.xlsx", XLSX_TYPE);
    await wb.xlsx.write(res);
    res.end();
  }

  @Get("discount-circular/pdf")
  @ApiOperation({ summary: "DiscountCircular.pdf — GAIL's live terms vs every other producer's latest" })
  async discountCircularPdf(@Res() res: Response) {
    const buf = await this.pdf.discountCircularPdf();
    attachment(res, "DiscountCircular.pdf", PDF_TYPE);
    res.send(buf);
  }

  @Get("grade-mapping/excel")
  @ApiOperation({ summary: "GradeMapping.xlsx — every grade, its equivalents, and status" })
  async gradeMappingExcel(@Res() res: Response) {
    const wb = await this.excel.gradeMappingWorkbook();
    attachment(res, "GradeMapping.xlsx", XLSX_TYPE);
    await wb.xlsx.write(res);
    res.end();
  }

  @Get("location-master/excel")
  @ApiOperation({ summary: "LocationMaster.xlsx — every location and its producer zone mappings" })
  async locationMasterExcel(@Res() res: Response) {
    const wb = await this.excel.locationMasterWorkbook();
    attachment(res, "LocationMaster.xlsx", XLSX_TYPE);
    await wb.xlsx.write(res);
    res.end();
  }
}
