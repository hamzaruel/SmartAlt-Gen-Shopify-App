# 🗺️ Sitemap Explorer

A powerful web application that analyzes website sitemap structures and provides detailed insights into content distribution. Simply enter any website URL and instantly discover how many products, blogs, collections, and pages exist on that site.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![React](https://img.shields.io/badge/React-18-blue)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.3-38bdf8)

---

## 📖 Project Overview

**Sitemap Explorer** is a Next.js-based web tool designed for SEO professionals, developers, and website analysts. It automatically fetches and parses any website's `sitemap.xml` file, identifies child sitemaps (products, collections, blogs, pages), counts the URLs within each category, and presents the data in an intuitive dashboard format.

### Why Use Sitemap Explorer?

- 🔍 **Quick Analysis**: Instantly understand a website's content structure
- 📊 **Visual Dashboard**: See counts for products, collections, blogs, and pages at a glance
- 📥 **Export Data**: Download reports as JSON or CSV
- 🎨 **Modern UI**: Clean, responsive design built with ShadCN UI components
- ⚡ **Fast Performance**: Efficient parsing with concurrent sitemap fetching

---

## ✨ Key Features

- **Automatic Sitemap Detection**: Fetches `sitemap.xml` from any URL
- **Recursive Parsing**: Identifies and processes all child sitemap files
- **Smart Categorization**: Automatically classifies sitemaps by type (products, blogs, collections, pages)
- **Real-time Counting**: Accurately counts URLs in each sitemap
- **Interactive Dashboard**: 
  - 4 stat cards showing category totals
  - Detailed table with all sitemap URLs
  - External link access to view raw sitemaps
- **Export Functionality**: 
  - Export to JSON format
  - Export to CSV format
- **Error Handling**: Graceful handling of missing or blocked sitemaps
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile
- **Loading States**: Visual feedback during analysis

---

## 🛠️ Tech Stack

### Frontend
- **[Next.js 14](https://nextjs.org/)** - React framework with App Router
- **[React 18](https://react.dev/)** - UI component library
- **[Tailwind CSS 3](https://tailwindcss.com/)** - Utility-first CSS framework
- **[ShadCN UI](https://ui.shadcn.com/)** - Beautiful, accessible components
- **[Lucide React](https://lucide.dev/)** - Icon library

### Backend
- **[Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)** - Serverless API endpoints
- **[Node.js](https://nodejs.org/)** - JavaScript runtime
- **[Axios](https://axios-http.com/)** - HTTP client for sitemap fetching
- **[xml2js](https://www.npmjs.com/package/xml2js)** - XML parser

### Development Tools
- **Yarn** - Package manager
- **ESLint** - Code linting
- **PostCSS** - CSS processing

---

## 📁 Folder Structure

```
sitemap-explorer/
├── app/
│   ├── api/
│   │   └── [[...path]]/
│   │       └── route.js          # API endpoint for sitemap analysis
│   ├── layout.js                 # Root layout with metadata
│   ├── page.js                   # Main page component
│   └── globals.css               # Global styles
├── components/
│   └── ui/                       # ShadCN UI components
│       ├── button.jsx
│       ├── card.jsx
│       ├── input.jsx
│       ├── table.jsx
│       └── alert.jsx
├── lib/
│   └── utils.js                  # Utility functions
├── public/                       # Static assets
├── .env                          # Environment variables
├── .gitignore                    # Git ignore rules
├── next.config.js                # Next.js configuration
├── package.json                  # Dependencies and scripts
├── postcss.config.js             # PostCSS configuration
├── tailwind.config.js            # Tailwind configuration
└── README.md                     # This file
```

---

## 📦 Installation Guide

### Prerequisites

Before you begin, ensure you have the following installed on your Mac:

- **Node.js** (v18.0.0 or higher) - [Download here](https://nodejs.org/)
- **Yarn** (v1.22.0 or higher)

To check if Node.js is installed:
```bash
node --version
```

To install Yarn globally:
```bash
npm install -g yarn
```

### Step 1: Clone or Download the Project

```bash
# If using Git
git clone https://github.com/hamzaruel/Sitemap-Explorer.git
cd sitemap-explorer

# Or download and extract the ZIP file, then navigate to the folder
cd /path/to/sitemap-explorer
```

### Step 2: Install Dependencies

```bash
yarn install
```

This will install all required packages listed in `package.json`.

### Step 3: Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
touch .env
```

Add the following content (see next section for details):

```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

### Step 4: Verify Installation

Check that all dependencies are installed correctly:

```bash
yarn --version
node --version
```

---

## 🔐 Environment Variables

Create a `.env` file in the root of your project with the following variables:

```env
# Base URL for the application
NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Optional: Custom port (default is 3000)
# PORT=3000
```

### Environment Variable Descriptions

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `NEXT_PUBLIC_BASE_URL` | Base URL for API calls and app routing | Yes | `http://localhost:3000` |

> **Note**: Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser. Keep sensitive API keys without this prefix.

---

## 🚀 How to Run the Project

### Development Mode

Start the development server with hot-reload:

```bash
yarn dev
```

The application will be available at:
```
http://localhost:3000
```

You should see output like:
```
✓ Ready in 2.5s
- Local:   http://localhost:3000
```

### Production Build

To create an optimized production build:

```bash
# Build the application
yarn build

# Start the production server
yarn start
```

### Running on a Custom Port

If port 3000 is already in use:

```bash
yarn dev -p 3001
```

Then visit `http://localhost:3001`

---

## 🎯 How to Use

1. **Open the Application**: Navigate to `http://localhost:3000` in your browser

2. **Enter a Website URL**: Type any website URL in the input field
   ```
   Example: https://www.shopify.com
   ```

3. **Generate Report**: Click the "Generate Report" button

4. **View Results**: 
   - See total counts for Products, Collections, Blogs, and Pages
   - Browse the detailed sitemap table
   - Click external link icons to view raw sitemap files

5. **Export Data** (optional):
   - Click "Export as JSON" for machine-readable format
   - Click "Export as CSV" for spreadsheet compatibility

---

## 🧪 Testing the API

You can test the API endpoint directly using cURL:

```bash
curl -X POST http://localhost:3000/api/sitemap \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.example.com"}'
```

Expected response:
```json
{
  "success": true,
  "mainSitemap": "https://www.example.com/sitemap.xml",
  "totalSitemaps": 4,
  "sitemaps": [
    {
      "url": "https://www.example.com/sitemap_products.xml",
      "type": "products",
      "count": 1250
    }
  ],
  "counts": {
    "products": 1250,
    "collections": 45,
    "blogs": 120,
    "pages": 35,
    "other": 0
  }
}
```

---

## 🐛 Troubleshooting

### Common Issues and Solutions

#### 1. **Port 3000 is already in use**

**Error:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**
```bash
# Kill the process using port 3000
lsof -ti:3000 | xargs kill -9

# Or run on a different port
yarn dev -p 3001
```

#### 2. **Module not found errors**

**Error:**
```
Module not found: Can't resolve 'axios'
```

**Solution:**
```bash
# Clear node_modules and reinstall
rm -rf node_modules
rm yarn.lock
yarn install
```

#### 3. **ShadCN components not found**

**Error:**
```
Module not found: Can't resolve '@/components/ui/button'
```

**Solution:**
```bash
# Ensure all ShadCN components are installed
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add input
npx shadcn-ui@latest add table
npx shadcn-ui@latest add alert
```

#### 4. **CORS errors when fetching sitemaps**

**Issue:** Some websites block requests from non-browser agents.

**Solution:** This is expected behavior. The app includes proper User-Agent headers, but some sites have strict CORS policies. The error handling will display a friendly message.

#### 5. **Build errors**

**Error:**
```
Error: Cannot find module 'next/server'
```

**Solution:**
```bash
# Reinstall Next.js
yarn add next@latest react@latest react-dom@latest
```

#### 6. **Tailwind styles not loading**

**Solution:**
```bash
# Rebuild Tailwind
npx tailwindcss -i ./app/globals.css -o ./output.css --watch
```

---

## 🔮 Future Improvements

Here are some planned enhancements for future versions:

### Features
- [ ] **Pie Chart Visualization** - Visual representation of content distribution using Chart.js or Recharts
- [ ] **Historical Tracking** - Save and compare sitemap analysis over time
- [ ] **Bulk Analysis** - Analyze multiple websites at once
- [ ] **Advanced Filters** - Filter sitemaps by date, priority, or change frequency
- [ ] **Custom Categorization** - Allow users to define custom sitemap categories
- [ ] **URL Pattern Analysis** - Identify URL structures and patterns
- [ ] **Sitemap Health Check** - Validate sitemap structure and identify issues
- [ ] **API Rate Limiting** - Implement rate limiting for API endpoints
- [ ] **User Authentication** - Save reports to user accounts
- [ ] **Email Reports** - Schedule and email automated reports

### Technical Improvements
- [ ] Add comprehensive unit tests (Jest)
- [ ] Add E2E tests (Playwright)
- [ ] Implement caching for frequently analyzed sites
- [ ] Add support for gzipped sitemaps
- [ ] Docker containerization
- [ ] CI/CD pipeline setup
- [ ] Performance monitoring (Vercel Analytics)
- [ ] Error tracking (Sentry)
- [ ] Database integration for report storage (MongoDB/PostgreSQL)
- [ ] GraphQL API option

### UI/UX Enhancements
- [ ] Dark mode toggle
- [ ] Advanced search and filtering in results table
- [ ] Comparison view for multiple websites
- [ ] Customizable dashboard widgets
- [ ] Share reports via unique URLs
- [ ] Print-friendly report layout
- [ ] Accessibility improvements (WCAG AA compliance)
- [ ] Localization (i18n support)

---

## 📄 API Documentation

### POST `/api/sitemap`

Analyzes a website's sitemap structure.

**Request Body:**
```json
{
  "url": "https://www.example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "mainSitemap": "https://www.example.com/sitemap.xml",
  "totalSitemaps": 5,
  "sitemaps": [
    {
      "url": "https://www.example.com/sitemap_products.xml",
      "type": "products",
      "count": 1500
    },
    {
      "url": "https://www.example.com/sitemap_blogs.xml",
      "type": "blogs",
      "count": 250
    }
  ],
  "counts": {
    "products": 1500,
    "collections": 75,
    "blogs": 250,
    "pages": 120,
    "other": 50
  }
}
```

**Error Response (404):**
```json
{
  "error": "Unable to fetch sitemap.xml",
  "message": "The website does not have a publicly accessible sitemap.xml file, or it blocked our request.",
  "details": "Request failed with status code 404"
}
```

**Error Response (400):**
```json
{
  "error": "URL is required"
}
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use ESLint for JavaScript/TypeScript linting
- Follow the existing code structure and naming conventions
- Write meaningful commit messages
- Add comments for complex logic
- Update documentation for new features

---

## 🐞 Bug Reports

If you discover a bug, please create an issue with the following information:

- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Browser and OS information

---

## 📞 Support

For questions or support:

- 📧 Email: support@sitemapexplorer.com
- 💬 GitHub Issues: [Create an issue](https://github.com/yourusername/sitemap-explorer/issues)
- 📖 Documentation: [Wiki](https://github.com/yourusername/sitemap-explorer/wiki)

---

## 📊 Project Stats

- **Lines of Code**: ~1,200
- **Components**: 15+
- **API Endpoints**: 1
- **Supported Sitemap Types**: 5 (Products, Collections, Blogs, Pages, Other)

---

## 🙏 Acknowledgments

- [Next.js Team](https://nextjs.org/) - Amazing React framework
- [ShadCN](https://ui.shadcn.com/) - Beautiful component library
- [Vercel](https://vercel.com/) - Hosting and deployment platform
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework

---



## 🌟 Star the Project

If you find this project useful, please consider giving it a ⭐ on GitHub!

---


**You Can Check Live on Vercel**  https://sitemap-explorer.vercel.app/



shopify app dev --use-localhost
