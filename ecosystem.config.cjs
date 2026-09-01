module.exports = {
    apps: [
        {
            name: "mysql-manager",
            script: "backend/dist/index.js",
            watch: false,
            env: {
                NODE_ENV: "development",
                PORT: 3333,
                JWT_SECRET_KEY: "securityHardToFind#5801"
            }
        }
    ]
}