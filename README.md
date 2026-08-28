# 🗄️ Universal Database Manager (MySQL & PostgreSQL)

A powerful, real-time web-based database management tool built with modern web technologies. This application provides a comprehensive interface for managing both **MySQL** and **PostgreSQL** databases, tables, and data with advanced features like AI-assisted querying, ER diagrams, search, sorting, table alteration, data export, and copy functionality.

[ ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[ ![Node.js Version](https://img.shields.io/badge/node.js-v20%2B-green.svg)](https://nodejs.org/)
[ ![TypeScript](https://img.shields.io/badge/typescript-v5.6%2B-blue.svg)](https://www.typescriptlang.org/)
[ ![Svelte](https://img.shields.io/badge/svelte-v5%2B-ff3e00.svg)](https://svelte.dev/)
[ ![Tailwind CSS](https://img.shields.io/badge/tailwindcss-v4%2B-38B2AC.svg)](https://tailwindcss.com/)

## 🚀 Features

### 🔗 **Database Connectivity**
* **Multi-Engine Support**: Connect to and manage both MySQL and PostgreSQL databases.
* **Connection Manager**: Locally save and manage frequently used connection profiles for quick access.
* **Real-time Connection Management**: Connect/disconnect with live status updates and session persistence.
* **Secure Authentication**: Support for username/password authentication with configurable host, port, and SSL/TLS.
* **Multi-user Support**: Handles multiple concurrent database connections efficiently.

### 🤖 **AI Assistant (Ollama Integration)**
* **Natural Language Queries**: Ask the integrated Ollama AI to help write complex SQL queries.
* **Database Insights**: Get AI-driven insights about your database structure and data.
* **Chat Interface**: Convenient chat UI directly within the database manager.

### 📊 **System Overview & Dashboards**
* **Visual Dashboards**: See high-level metrics for your database server.
* **Storage Analysis**: Interactive views showing database sizes and individual table storage utilization.
* **Resource Tracking**: Easily identify which tables are consuming the most space.

### 🗺️ **ER Diagrams & Visualizations**
* **Entity-Relationship Diagrams**: Automatically generate ER diagrams for your databases.
* **Visual Schema**: Explore table relationships and constraints visually.

### 🗃️ **Database & Table Management**
* **Database Operations**: Create, drop, and browse databases.
* **Table Management**: View table lists, create/drop tables, and explore table relationships.
* **Real-time Updates**: Instant UI updates when databases or tables are modified via Socket.IO.
* **Smart Refresh**: Automatic data refresh with manual refresh options.

### 🔍 **Advanced Data Viewing**
* **Paginated Data Display**: Efficient data loading with customizable page sizes.
* **Advanced Search**: Search within specific columns with pattern matching.
* **Dynamic Sorting**: Click-to-sort on any column with ascending/descending indicators.
* **Data Type Handling**: Proper display of NULL values, numbers, strings, and dates.
* **Copy Functionality**: One-click copy for individual cells and entire rows.

### 🔧 **Table Structure Management**
* **Column Management**: Add, modify, and drop table columns with an intuitive UI.
* **Data Type Support**: Full MySQL & PostgreSQL data type support.
* **Index & Constraint Management**: Create, view, and drop table indexes and constraints.
* **Table Alteration GUI**: Easy-to-use interface for complex table modifications.

### 📝 **Advanced SQL Query Interface**
* **CodeMirror 6 Integration**: Premium SQL editor with syntax highlighting, autocomplete, and theme support.
* **Multi-query Execution**: Execute multiple SQL statements in a single operation.
* **Floating Query Window**: Run ad-hoc queries from anywhere in the application.
* **Query Results Display**: Formatted results with proper data type handling.

### 📥 **Export & Backup Capabilities**
* **Database & Table Export**: Export complete databases or individual tables.
* **Selective Export**: Choose specific tables for database export.
* **Custom Filtering**: Export data with custom WHERE clauses.
* **Multiple Formats**: SQL dump format with proper syntax for the target engine.

### 🎨 **Modern Premium User Interface**
* **Svelte 5 & Tailwind CSS**: Modern, reactive, and beautifully styled with Tailwind CSS v4 and Shadcn Svelte.
* **Premium Design**: Clean aesthetic with 'Inter' typography and smooth animations.
* **Dark Mode Sidebar**: Professional contrast with a sleek dark sidebar.
* **Responsive Layouts**: Works seamlessly on all screen sizes.
* **Real-time Notifications**: Toast notifications for all operations.

## 🛠️ Technology Stack

### **Backend**
* **Node.js & TypeScript**: Strongly-typed server runtime environment.
* **Express.js**: Web application framework.
* **Socket.IO**: Real-time bidirectional communication.
* **MySQL2 & pg**: Native database drivers with Promise support.
* **Express Session & JWT**: Secure session management and token authentication.
* **Custom DatabaseManager**: Abstracted multi-engine database operation handler.

### **Frontend**
* **Svelte 5 & SvelteKit**: Cutting-edge reactive UI framework with Runes.
* **Tailwind CSS v4 & Shadcn Svelte**: Utility-first CSS framework with premium pre-built components.
* **Vite**: Next-generation frontend tooling.
* **CodeMirror 6**: Extensible code editor for SQL text areas.
* **Socket.IO Client**: Real-time communication with the server.
* **Lucide Icons**: Beautiful, consistent icon set.

## 📁 Project Structure

```
mysql_handler/
├── backend/
│   ├── src/
│   │   ├── database/        # Multi-engine database operations
│   │   ├── socket/          # Socket.IO event handlers
│   │   ├── routes/          # Express API routes
│   │   ├── types/           # TypeScript type definitions
│   │   └── index.ts         # Server entry point
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/  # Svelte components (Dashboard, SqlEditor, etc.)
│   │   │   ├── services/    # Socket & API services
│   │   │   └── state.svelte.ts # Global application state (Svelte 5 Runes)
│   │   ├── routes/          # SvelteKit pages
│   │   └── app.html
│   ├── package.json
│   └── svelte.config.js
├── package.json             # Monorepo root
└── pnpm-workspace.yaml      # PNPM workspace definition
```

## 🚀 Quick Start

### Prerequisites
* **Node.js** v20.0.0 or higher
* **pnpm** package manager
* **MySQL** and/or **PostgreSQL** server

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/mmar58/mysql_handler.git
   cd mysql_handler
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the `backend` directory:
   ```env
   PORT=3000
   NODE_ENV=development
   SESSION_SECRET=your_secret_here
   ```

4. **Start Development Servers**
   ```bash
   pnpm dev
   ```
   *This will concurrently start the TypeScript backend (via `tsx`) and the SvelteKit frontend (via `vite`).*

5. **Access the application**
   Open your browser and navigate to the URL provided by Vite (usually `http://localhost:5173`).

### Building for Production

```bash
pnpm build
pnpm start
```

## 💻 Usage Guide

1. **Connecting**: Use the Connection Manager to add a new MySQL or PostgreSQL profile. 
2. **Dashboard**: View the System Overview to see storage usage.
3. **Data Grid**: Click a table to view, search, sort, and edit its data.
4. **Structure**: Switch to the Structure tab to alter columns, indexes, and constraints.
5. **AI Chat**: Open the Ollama Chat assistant from the top navigation to ask questions or generate SQL.
6. **SQL Editor**: Use the fully-featured CodeMirror SQL editor to run custom queries.

## 🤝 Contributing
1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature-name`
3. **Commit changes**: `git commit -am 'Add feature'`
4. **Push to branch**: `git push origin feature-name`
5. **Submit a pull request**

## 📝 License
This project is licensed under the MIT License - see the LICENSE file for details.

---

**Built with ❤️ by [mmar58](https://github.com/mmar58)**

*Happy Database Managing! 🎉*