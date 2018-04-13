import brain from 'brain.js'
import malScraper from 'mal-scraper'
import got from 'got'
import cheerio from 'cheerio'
import PQueue from 'p-queue'

const queue = new PQueue({ concurrency: 1, autoStart: false })
let size = 0

function fixLengths(data) {
    let maxLengthInput = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i].input.length > maxLengthInput) {
            maxLengthInput = data[i].input.length;
        }
    }

    for (let i = 0; i < data.length; i++) {
        while (data[i].input.length < maxLengthInput) {
            data[i].input.push(0);
        }
    }

    size = maxLengthInput
    return data;
}

const getGenreList = async () => {
    const genreList = {}

    const res = await got('https://myanimelist.net/anime.php')

    const $ = cheerio.load(res.body)
    $('div.normal_header.pt24.mb0')
        .eq(1)
        .next('div.genre-link')
        .find('a.genre-name-link')
        .each((i, el) => {
            const href = $(el).attr('href').replace('/anime/genre/', '').split('/')
            const genreName = href[1].replace(/_/g, ' ')
            genreList[genreName] = parseInt(href[0], 10)
        })

    const genreNbr = Object.keys(genreList).length

    const map = new Map()
    for (const key in genreList) 
        map.set(key, genreList[key] / genreNbr)
        // genreList[key] = genreList[key] / genreNbr

    return map
}

const getCompletedAnimeList = async () => {
    const { lists } = await malScraper.getWatchListFromUser('AzSiAz')
    
    return lists.filter(el => el.status === '2')
}

const getAnimeData = (completedAnimeList) => new Promise(resolve => {
    const animesDetail = []

    completedAnimeList.forEach(anime => {
        queue.add(() =>
            malScraper.getInfoFromURL(
                `https://myanimelist.net/anime/${anime.id}/${anime.title.replace(/ /, '_')}`
            ).then(({ title, score, genres }) =>
                animesDetail.push({
                    title,
                    averageNote: score,
                    genres,
                    note: anime.score
                })
            )
        )
    })

    console.log(`${queue.size} animes added to queue`)
    queue.start()
    queue.onIdle().then(() => resolve(animesDetail))
})

const getTrainingData = async (animesList, genresMap) => {
    return animesList.map(anime => ({
        input: anime.genres.map(genre => genresMap.get(genre)),
        output: { 
            note: parseInt(anime.note, 10) / 10
        }
    }))
}

const main = async () => {
    console.log('Starting')
    const net = new brain.NeuralNetwork()

    console.log('Getting genres list')
    const genreMap = await getGenreList()
    console.log(`Got ${genreMap.size} genres`)

    console.log('Getting animes list')
    const completedAnimeList = await getCompletedAnimeList()
    console.log(`Got ${completedAnimeList.length} completed animes`)

    console.log(`Getting data for ${completedAnimeList.length} animes so it might take some time`)
    const animesList = await getAnimeData(completedAnimeList)
    console.log(`Done getting animes data for ${animesList.length}`)

    console.log(`Converting raw data into training data`)
    const trainingData = await getTrainingData(animesList, genreMap)
    console.log(`Done converting raw data into training data`)
    
    // @ts-ignore
    net.train(fixLengths(trainingData))

    const fix = (data) => {
        while (data.length < size) {
            data.push(0);
        }
        return data
    }
    const anime = ['Action', 'Mystery', 'Horror', 'Psychological', 'Supernatural', 'Drama', 'Seinen'].map(x => genreMap.get(x))

    // @ts-ignore
    const result = net.run(fix(anime))

    console.log(result)
}

main().catch(err => console.error(err))
