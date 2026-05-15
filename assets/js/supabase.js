// ============================================================
// SUPABASE CONFIG — replace with your project credentials
// ============================================================
const SUPABASE_URL = 'https://wxkjawbawewnwgxzcyzv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4a2phd2Jhd2V3bndneHpjeXp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTc2NjIsImV4cCI6MjA5NDM5MzY2Mn0.WEVoliq-eh4tc7ikd-oA6a6RN87Pwnu0lqYl9GmYEDA';

// Initialize Supabase client (loaded via CDN in HTML)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Export for use across modules
window.sb = supabase;