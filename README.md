# Baby Barn Admin Dashboard - Backend API

A production-ready Node.js + Express.js REST API with PostgreSQL, Prisma ORM, and clean architecture.

## Features

- **Clean Architecture**: Controllers → Services → Repositories pattern
- **JWT Authentication**: Secure token-based auth with refresh tokens
- **Role-Based Access Control (RBAC)**: Admin, User, Guest roles
- **Request Validation**: Zod schemas for all endpoints
- **Error Handling**: Centralized error handling with custom AppError
- **Database**: PostgreSQL with Prisma ORM
- **API Documentation**: RESTful endpoints with clear patterns
- **Security**: Password hashing, CORS, rate limiting ready

## Tech Stack

- **Runtime**: Node.js 18+ (recommend 20 LTS)
- **Framework**: Express.js 4.x
- **Database**: PostgreSQL 14+
- **ORM**: Prisma 5.x
- **Language**: JavaScript (ES modules)
- **Validation**: Zod
- **Authentication**: JWT with bcryptjs
- **Package Manager**: pnpm

## Project Structure

```
backend/
├── index.js                        # Application entry point
├── config/
│   └── env.js                      # Environment variables
├── middleware/
│   └── auth.js                     # Authentication middleware
├── utils/
│   ├── error-handler.js            # Error handling
│   ├── jwt.js                      # JWT utilities
│   └── validation.js               # Validation helpers
├── schemas/
│   └── index.js                    # Zod validation schemas
├── services/
│   ├── auth.service.js             # Authentication logic
│   ├── product.service.js          # Product business logic
│   ├── category.service.js         # Category logic
│   └── order.service.js            # Order business logic
├── controllers/
│   ├── auth.controller.js          # Auth endpoints
│   ├── product.controller.js       # Product endpoints
│   └── order.controller.js         # Order endpoints
├── routes/
│   ├── auth.js                     # Auth routes
│   ├── products.js                 # Product routes
│   └── orders.js                   # Order routes
├── scripts/
│   └── seed.js                     # Prisma seed (roles)
├── prisma/
│   ├── schema.prisma               # Database schema
│   └── migrations/                 # Database migrations
├── .env.example                    # Environment template
├── package.json
└── README.md
```

## Database Schema

### Users Table
- id, email, password, firstName, lastName, role, createdAt, updatedAt

### Products Table
- id, name, description, price, categoryId, stock, createdAt, updatedAt

### Categories Table
- id, name, description, createdAt, updatedAt

### Orders Table
- id, userId, totalAmount, status, createdAt, updatedAt

### OrderItems Table
- id, orderId, productId, quantity, price, createdAt

## Setup & Installation

### Prerequisites

- Node.js 18+ (recommend 20 LTS)
- PostgreSQL 14+
- pnpm or npm

### Installation

```bash
# Navigate to backend
cd backend

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# DATABASE_URL=postgresql://user:password@localhost:5432/babybarn
# JWT_SECRET=your-secret-key-here
# JWT_REFRESH_SECRET=your-refresh-secret-here
```

### Database Setup

```bash
# Generate Prisma client
pnpm prisma generate

# Create and run migrations
pnpm prisma migrate dev --name init

# (Optional) Seed database
pnpm prisma db seed
```

### Development

```bash
# Start development server with hot reload (Node --watch)
npm run dev

# Server runs on http://localhost:5000 (or PORT from .env)
```

### Production Build

```bash
# Generate Prisma Client (no compile step — plain Node.js)
npm run build

# Start production server
npm start
```

## Environment Variables

Create `.env`:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/babybarn

# JWT
JWT_SECRET=your-super-secret-key-change-this
JWT_REFRESH_SECRET=your-refresh-secret-change-this
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Server
PORT=3001
NODE_ENV=development

# CORS
CORS_ORIGIN=http://localhost:3000

# Logging
LOG_LEVEL=info
```

## API Endpoints

### Authentication

```
POST   /api/auth/register              Register new user
POST   /api/auth/login                 Login user
POST   /api/auth/refresh-token         Refresh JWT token
POST   /api/auth/forgot-password       Request password reset
POST   /api/auth/reset-password        Reset password with token
```

### Products

```
GET    /api/products                   List all products (paginated)
GET    /api/products/:id               Get product by ID
POST   /api/products                   Create product (ADMIN)
PATCH  /api/products/:id               Update product (ADMIN)
DELETE /api/products/:id               Delete product (ADMIN)
```

### Orders

```
GET    /api/orders                     List user's orders
GET    /api/orders/:id                 Get order details
POST   /api/orders                     Create order
PATCH  /api/orders/:id                 Update order status (ADMIN)
GET    /api/orders/admin/all           List all orders (ADMIN)
```

### Users

```
GET    /api/users/:id                  Get user profile
PATCH  /api/users/:id                  Update profile
GET    /api/users                      List all users (ADMIN)
PATCH  /api/users/:id/role             Update user role (ADMIN)
DELETE /api/users/:id                  Delete user (ADMIN)
```

## Authentication & RBAC

### Roles

- **ADMIN**: Full system access
- **USER**: Can create orders, view own data
- **GUEST**: Public access only

### JWT Token Structure

```typescript
{
  sub: 'user-id',
  email: 'user@example.com',
  role: 'USER',
  iat: timestamp,
  exp: timestamp
}
```

### Protected Routes

Add `@Authenticate()` decorator or use middleware:

```typescript
router.get('/admin/data', authenticate, adminOnly, controller.getAdminData);
```

## Error Handling

### AppError Class

```typescript
throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
```

### Error Response Format

```json
{
  "success": false,
  "message": "Error message",
  "code": "ERROR_CODE",
  "statusCode": 400
}
```

## Validation

### Request Validation with Zod

```typescript
import { z } from 'zod';

const createProductSchema = z.object({
  name: z.string().min(3),
  price: z.number().positive(),
  categoryId: z.string().uuid(),
});

// In controller
const data = createProductSchema.parse(req.body);
```

## Development Guidelines

### Service Layer

Business logic lives in services, not controllers:

```typescript
// controllers/product.controller.ts
async createProduct(req, res) {
  const data = productSchema.parse(req.body);
  const product = await productService.create(data);
  res.json({ data: product });
}

// services/product.service.ts
async create(data: CreateProductDTO) {
  return await prisma.product.create({ data });
}
```

### Error Handling

```typescript
try {
  // ... logic
} catch (error) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json(error.toJSON());
  } else {
    res.status(500).json({ message: 'Internal server error' });
  }
}
```

### Code Style

- Use JavaScript ES modules; keep modules small and focused
- Async/await over promise chains
- Centralize configuration
- Keep controllers thin
- Validate all inputs
- Handle errors gracefully

### Naming Conventions

- Files: `kebab-case` or `name.service.js` / `name.controller.js`
- Classes: `PascalCase` (e.g., `AuthService`)
- Functions: `camelCase` (e.g., `getUser`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `JWT_SECRET`)
- Database fields: `camelCase` in code, `snake_case` in SQL

## Database Migrations

### Create a Migration

```bash
pnpm prisma migrate dev --name add_user_phone
```

### Apply Migrations

```bash
pnpm prisma migrate deploy
```

### View Migrations

```bash
pnpm prisma migrate status
```

## Deployment

### Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create babybarn-api

# Set environment variables
heroku config:set DATABASE_URL=<your-postgres-url>
heroku config:set JWT_SECRET=<your-secret>

# Deploy
git push heroku main
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3001
CMD ["pnpm", "start"]
```

### Railway/Render

1. Connect GitHub repository
2. Set environment variables in platform dashboard
3. Automatic deployment on push
4. Database provisioning through platform

## Testing

### Unit Tests

```bash
pnpm test
```

### Integration Tests

```bash
pnpm test:integration
```

### E2E Tests

```bash
pnpm test:e2e
```

## Performance Optimization

### Database Indexing

```prisma
model Product {
  id    String  @id @default(cuid())
  name  String  @unique
  email String  @unique
  @@index([categoryId])
}
```

### Pagination

```typescript
const skip = (page - 1) * limit;
const products = await prisma.product.findMany({
  skip,
  take: limit,
});
```

### Query Optimization

Use `select` or `include` to fetch only needed fields:

```typescript
const user = await prisma.user.findUnique({
  where: { id },
  select: { id: true, email: true, name: true },
});
```

## Troubleshooting

### Database Connection Issues

- Check `DATABASE_URL` in `.env`
- Ensure PostgreSQL is running
- Verify database credentials
- Check firewall rules

### Migration Errors

```bash
# Reset database (development only!)
pnpm prisma migrate reset

# Resolve conflicts
pnpm prisma migrate resolve --rolled-back <migration-name>
```

### JWT Token Issues

- Verify `JWT_SECRET` is set
- Check token expiration
- Ensure refresh token logic is working
- Review token generation in auth service

## License

MIT

## Support

For issues, check the main project documentation or create an issue in the repository.
