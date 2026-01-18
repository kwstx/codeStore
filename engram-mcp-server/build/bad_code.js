// This file contains a violation of our project rules
// Rule: Do not use raw fetch, use networkClient.safeRequest
export async function getData(url) {
    console.log("Fetching data...");
    const response = await fetch(url); // <--- VIOLATION
    return response.json();
}
