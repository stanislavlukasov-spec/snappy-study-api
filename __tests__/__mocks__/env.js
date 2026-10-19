// Mock env module — prevents Zod validation from throwing at import time
module.exports = {
  env: {
    OPENAI_API_KEY: 'sk-test-mock',
  },
};
