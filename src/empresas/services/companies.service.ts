import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async findBySubdomain(subdomain: string) {
    return this.prisma.empresa.findUnique({
      where: { subdominio: subdomain },
    });
  }

  async findById(id: string) {
    return this.prisma.empresa.findUnique({
      where: { id },
    });
  }

  async create(data: any) {
    return this.prisma.empresa.create({
      data,
    });
  }
}