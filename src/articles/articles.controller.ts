import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { ArticlesService } from './articles.service';
import {
  CreateArticleCategoryDto,
  CreateArticleDto,
  UpdateArticleCategoryDto,
  UpdateArticleDto,
} from './dto/article.dto';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  findAllPublished(
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('featured') featured?: string,
    @Query('sort') sort?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.articlesService.findAllPublished({
      q,
      category,
      tag,
      featured,
      sort,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 12,
    });
  }

  @Get('facets')
  getFacets() {
    return this.articlesService.getFacets();
  }

  @Get('categories')
  findAllCategories() {
    return this.articlesService.findAllCategories();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS', 'ADMINISTRATOR')
  @Post('categories')
  createCategory(@Body() dto: CreateArticleCategoryDto) {
    return this.articlesService.createCategory(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS', 'ADMINISTRATOR')
  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleCategoryDto,
  ) {
    return this.articlesService.updateCategory(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS', 'ADMINISTRATOR')
  @Delete('categories/:id')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.articlesService.removeCategory(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMINISTRATOR')
  @Get('admin/all')
  findAllForAdmin(@Query('status') status?: string) {
    return this.articlesService.findAllForAdmin(status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS')
  @Get('writer/mine')
  findMine(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
  ) {
    return this.articlesService.findByAuthor(req.user.userId, status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS')
  @Get('writer/:id')
  findOneForAuthor(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.articlesService.findOneForAuthor(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS')
  @Post('upload-image')
  uploadImage(@Body() body: { base64?: string }) {
    return this.articlesService.uploadBase64Image(body?.base64 || '');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS')
  @Post()
  create(
    @Body() dto: CreateArticleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.articlesService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS', 'ADMINISTRATOR')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.articlesService.update(id, req.user.userId, dto, req.user.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PENULIS', 'ADMINISTRATOR')
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.articlesService.remove(id, req.user.userId, req.user.role);
  }

  @Get(':slug/related')
  findRelated(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.articlesService.findRelated(
      slug,
      limit ? parseInt(limit, 10) : 4,
    );
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string) {
    return this.articlesService.findBySlug(slug);
  }
}
