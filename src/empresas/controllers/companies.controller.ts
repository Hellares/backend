import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { CompaniesService } from '../services/companies.service';
import { CreateEmpresaDto } from '../dto/create-empresa.dto';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  create(@Body() createEmpresaDto: CreateEmpresaDto) {
    return this.companiesService.create(createEmpresaDto);
  }

  @Get('subdomain/:subdomain')
  findBySubdomain(@Param('subdomain') subdomain: string) {
    return this.companiesService.findBySubdomain(subdomain);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.companiesService.findById(id);
  }
}