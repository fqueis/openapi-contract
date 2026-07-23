/**
 * Minimal OpenAPI fixture for contract unit tests.
 *
 * Owns a tiny auth + users surface with local `$ref`s so deref, index, and
 * service enrichment tests share one known-good document. Intentionally small:
 * two operations, three component schemas, and one security scheme.
 */
export const sampleOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'Sample API',
    version: '1.2.3',
    description: 'Fixture for openapi-contract tests',
  },
  servers: [{ url: 'http://localhost:3000' }],
  tags: [{ name: 'auth', description: 'Authentication' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/v1/auth/login': {
      post: {
        operationId: 'login',
        tags: ['auth'],
        summary: 'Login',
        description: 'Exchange credentials for tokens',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginResponse' },
              },
            },
          },
        },
      },
    },
    '/v1/users/{id}': {
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      get: {
        operationId: 'getUser',
        tags: ['users'],
        summary: 'Get user',
        parameters: [
          {
            name: 'include',
            in: 'query',
            schema: { type: 'string', example: 'profile' },
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
  },
} as const;
