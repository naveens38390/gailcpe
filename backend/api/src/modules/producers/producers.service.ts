import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { Producer } from "../../database/schemas/catalog.schema";
import { DatasetService } from "../dataset/dataset.service";
import { MasterDataService } from "../master-data/master-data.service";
import { RevisionWorkflow } from "../master-data/revision-workflow";
import { CreateProducerDto, DraftProducerDto } from "./dto/producer-fields.dto";

@Injectable()
export class ProducersService extends MasterDataService {
  protected workflow: RevisionWorkflow;

  constructor(
    @InjectModel(Producer.name) private producers: Model<Producer>,
    @InjectModel("ProducerRevision") private revisions: Model<any>,
    private dataset: DatasetService,
  ) {
    super();
    this.workflow = new RevisionWorkflow(this.revisions, this.producers, "code");
  }

  /** A retired or reinstated producer changes who appears in every comparison. */
  protected invalidate(): void {
    this.dataset.invalidate();
  }

  async create(dto: CreateProducerDto, userId: string) {
    const { code, reason, submit, ...fields } = dto;
    const rev = await this.workflow.draft(code, fields, reason, userId, true);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }

  async draft(code: string, dto: DraftProducerDto, userId: string) {
    const { reason, submit, ...fields } = dto;
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const rev = await this.workflow.draft(code, clean, reason, userId, false);
    return submit === false ? rev : this.workflow.submit(String(rev._id), userId);
  }
}
