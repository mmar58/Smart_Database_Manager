module.exports = {
    apps: [
        {
            name: "mysql-manager",
            script: "src/server.js",
            watch: false,
            env: {
                NODE_ENV: "development",
                PORT: 3333,
                JWT_SECRET_KEY: "securityHardToFind#5801"
            }
        }
    ]
}