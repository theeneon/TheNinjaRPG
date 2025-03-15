# TheNinjaRPG Codebase Guide

## Build Commands
- `make dev` - Start development server
- `make lint` - Run ESLint
- `make build` - Build app for production
- `make seed` - Seed database
- `make dbpush` - Push schema to database without migrations
- `make makemigrations` - Create database migration file
- `make pnpm "add [package]"` - Add new package

## Code Style
- **TypeScript**: Strict mode with explicit type imports
- **Formatting**: Prettier with tailwindcss plugin
- **Error Handling**: Use `serverError()` for tRPC errors
- **Database**: Drizzle ORM with InferModel type definitions
- **Components**: React functional components with prop types
- **State Management**: React Context for global state, tRPC for server state

## Conventions
- Use gitmoji for commit messages
- Follow existing file/component structure
- Implement type-safety across components and data
- Use Tailwind for styling