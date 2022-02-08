// build/production configuration extends default/development configuration
module.exports = {
    extends: "./.eslintrc.js",
    rules: {
      // Since this is prototype, having console.log message is useful
      // "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error"
    }
};
