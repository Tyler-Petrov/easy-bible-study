const axios = require('axios');
const vscode = require('vscode');
const sqlite3 = require('sqlite3');

const wCAEntries = require("./resources/when_critics_ask.json");

const scriptureReferenceRegex = require("./syntaxes/devo.tmLanguage.json").repository.reference.match.replace('(?i)', '');

var kjvDatabase;

function parseMeaning(meaning) {
  return [
    `### ${capitalizeString(meaning.partOfSpeech)}`,
    ...meaning.definitions.map(function (definition) {
      var definitionString = `${definition.definition}`

      if (definition.example != undefined) {
        definitionString += ` \ \n Example: ${definition.example}`
      }

      if (0 < definition.synonyms.length) {
        definitionString += ` \ \n Synonyms: ${definition.synonyms.join(', ')}`
      }

      if (0 < definition.antonyms.length) {
        definitionString += ` \ \n Antonyms: ${definition.antonyms.join(', ')}`
      }

      return definitionString;
    }),
  ];
};

async function activate(context) {
  const dbPath = context.extensionPath + '/bible_versions/kjv.db';
  kjvDatabase = new sqlite3.Database(dbPath/* , sqlite3.OPEN_READONLY */)

  // Register a command to query the database
  let disposable = vscode.commands.registerCommand('extension.queryBooks', () => {
    kjvDatabase.all('SELECT * FROM Books', (err, rows) => {
      if (err) {
        vscode.window.showErrorMessage('Error querying database: ' + err.message);
        return;
      }
      if (rows.length === 0) {
        vscode.window.showInformationMessage('No books found in the database.');
      } else {
        vscode.window.showInformationMessage('Found ' + rows.length + ' books in the database.');
        console.log(rows);
      }
    });
  });

  context.subscriptions.push(disposable);

  try {

    context.subscriptions.push(
      vscode.languages.registerHoverProvider('devo', {
        async provideHover(document, position, token) {
          const wordRange = document.getWordRangeAtPosition(position);
          const word = document.getText(wordRange);

          const api_url = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;

          try {
            const response = await axios({
              "method": "GET",
              "url": api_url,
            });

            const dictionaryData = response.data[0]
            const meanings = dictionaryData.meanings

            var contents = [`## Definition of "${dictionaryData.word}"`]

            for (let i = 0; i < meanings.length; i++) {
              const meaning = meanings[i];
              const parsedMeaning = parseMeaning(meaning)

              for (let index = 0; index < parsedMeaning.length; index++) {
                const meaningElement = parsedMeaning[index];
                contents.push(meaningElement)
              }

            }

            return {
              contents: contents
            };
          } catch (err) {
            // console.log(err);
            return
          }
        }
      })
    );

    context.subscriptions.push(
      vscode.languages.registerHoverProvider('devo', {
        async provideHover(document, position, _token) {
          var regex = new RegExp(scriptureReferenceRegex, 'gi');
          const referenceRange = document.getWordRangeAtPosition(position, regex);
          const reference = document.getText(referenceRange);

          let referenceWords = reference.split(" "); // ["1", "Samuel", "8:28"]

          let referenceBook = referenceWords.slice(0, -1).join(' '); // "1 Samuel"
          let referenceChapterVerse = referenceWords[referenceWords.length - 1].split(':'); // ["8", "28"]
          let referenceChapter = referenceChapterVerse[0]; // "8"
          let referenceVerse = referenceChapterVerse[1]; // "28"

          const isMultiVerseReference = referenceVerse.includes('-');

          const book = fmtBookName(referenceBook);
          const chapter = referenceChapter;

          var fmtReference;

          if (isMultiVerseReference) {
            const verseSplit = referenceVerse.split('-');

            const beginningVerseNum = Math.min(Number(verseSplit[0]), Number(verseSplit[1]));
            const lastVerseNum = Math.max(Number(verseSplit[0]), Number(verseSplit[1]));

            const verses = await getVerses(book, chapter, beginningVerseNum, lastVerseNum);
            fmtReference = `${book} ${chapter}:${beginningVerseNum}-`;

            if (verses.length == 0) return { contents: [`## ${fmtReference}${lastVerseNum} has no valid verses`] };

            const lastValidVerseNum = verses[verses.length - 1].Verse

            return {
              contents: [
                `# ${fmtReference}${lastValidVerseNum} KJV`,
                ...fmtVerseObjList(verses)
              ]
            };
          }

          const verse = referenceVerse;

          const verses = await getVerses(book, chapter, verse, verse);
          fmtReference = `${book} ${chapter}:${verse}`;

          if (verses.length == 0) return { contents: [`## ${fmtReference} is not a verse`] };

          var contents = [
            `# ${fmtReference} KJV`,
            ...fmtVerseObjList(verses)
          ];

          const crossReferences = await getCrossReferences(verses[0].Id);

          if (0 < crossReferences.length) {
            var listOfReferences = []
            for (let index = 0; index < crossReferences.length; index++) {
              const verse = crossReferences[index];
              const verseReference = await getVerseReference(verse)
              const verseStr = `### ${verseReference} \ \n ${verse.Content}`;
              listOfReferences.push(verseStr)
            }

            contents = contents.concat(
              ["# Cross References"],
              listOfReferences
            )
          }

          const wCAEntry = wCAEntries.find((entry) => entry.reference == fmtReference.toUpperCase());

          if (wCAEntry != undefined) {
            contents.push(...[
              `## ${wCAEntry.question}
(from When Critics Ask)`,
              `### Problem:
${wCAEntry.problem}`,
              `### Solution:
${wCAEntry.solution}`,
            ]);
          }

          return {
            contents: contents
          };
        }
      })
    );

  } catch (error) {
    console.error(error)
  }
}

exports.activate = activate;

function deactivate() {
  kjvDatabase.close((err) => {
    if (err) return console.error(err.message);
    console.log('Database connection closed.');
  });
}

exports.deactivate = deactivate;

function query(queryStr, values) {
  return new Promise((resolve, reject) => {
    kjvDatabase.all(queryStr, values, (error, row) => {
      if (error) {
        console.error(error);
        reject(error);
      } else {
        resolve(row);
      }
    });
  });
}

async function getBookByStr(bookName) {
  const queryStr = `
    SELECT Books.* FROM Books
    JOIN BookNames ON Books.Id = BookNames.Book_id
    WHERE lower(BookNames.Name) = lower(:bookName);
  `;
  const values = { ':bookName': bookName };

  return (await query(queryStr, values))[0]
}

async function getVerses(bookName, chapterNum, firstVerseNum=0, lastVerseNum=500) {
  try {
    var book = await getBookByStr(bookName)

    const queryStr = `
      SELECT * FROM verses WHERE Book_id = :bookId AND Chapter = :chapter
      AND :firstVerse <= Verse AND Verse <= :lastVerse
    `;
    const values = {
      ':bookId': book.Id, ':chapter': chapterNum,
      ':firstVerse': firstVerseNum, ':lastVerse': lastVerseNum,
    };

    return await query(queryStr, values)
  } catch (error) {
    console.error(error)
    return null
  }
}

async function getCrossReferences(verseId) {
  try {
    const queryStr = `
      SELECT DISTINCT Verses.* FROM Verses
      JOIN CrossReferences ON Verses.Id = CrossReferences.Verse1 OR Verses.Id = CrossReferences.Verse2
      WHERE CrossReferences.Verse1 = :verseId OR CrossReferences.Verse2 = :verseId
      ORDER BY Verses.Book_id, Verses.Chapter, Verses.Verse
    `;
    const values = {
      ':verseId': verseId,
    };

    return await query(queryStr, values)
  } catch (error) {
    console.error(error)
    return null
  }
}

async function getVerseReference(verse) {
  const queryStr = `
    SELECT Name FROM Books WHERE Id = :bookId
  `;
  const values = { ':bookId': verse.Book_id };

  const book = await query(queryStr, values)

  return `${book[0].Name} ${verse.Chapter}:${verse.Verse}`
}

function fmtVerseObjList(verses) {
  return verses.map((verse) => `${verse.Verse} ${verse.Content}`)
}

function fmtBookName(bookName) {
  var newBookName = bookName.toLowerCase();
  if (newBookName == 'psalm') newBookName = 'psalms';
  if (newBookName == 'song of songs') newBookName = 'song of solomon';
  var wordsInBookName = newBookName.split(' ');
  return wordsInBookName.map((word) => capitalizeString(word)).join(' ');
}

function capitalizeString(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
