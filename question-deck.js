// A shared used set prevents repeats when switching categories in the same room.
function drawQuestions(room, pool, count, shuffle) {
  const unique = [...new Set(pool)];
  room.usedQuestions ||= new Set();
  const picked = [];
  while (picked.length < Math.min(count, unique.length)) {
    let available = unique.filter(q => !room.usedQuestions.has(q) && !picked.includes(q));
    if (!available.length) {
      unique.forEach(q => room.usedQuestions.delete(q));
      available = unique.filter(q => !picked.includes(q));
    }
    for (const q of shuffle(available)) {
      picked.push(q); room.usedQuestions.add(q);
      if (picked.length >= Math.min(count, unique.length)) break;
    }
  }
  return picked;
}
module.exports = { drawQuestions };
