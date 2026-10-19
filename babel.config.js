module.exports = {
  presets: [
    ['@babel/preset-typescript'],
  ],
  plugins: [
    // Transform ES module import/export to CommonJS so Jest (Node) can run them
    ['@babel/plugin-transform-modules-commonjs'],
  ],
};
