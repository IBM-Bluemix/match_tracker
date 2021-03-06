/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { EventEmitter } from 'events';
import Dispatcher from '../dispatcher/Dispatcher'
import Constants from '../constants/Constants'

const CHANGE_EVENT = 'change'

class Gameweek extends EventEmitter {
  constructor () {
    super()
    this.index = -1
    this.loading = true;
    this.fixtures = []
    this.tweets = {}
    this.table = []
    this.cursor = 0
    this.replay_state = "finished"
  }

  load (index, fixtures, tweets) {
    this.loading = false
    this.index = index
    this.fixtures = fixtures
    this.tweets = tweets
    this.cursor = 7200
    const match_tweets = this._getMatchTweets(0, this.cursor)
    this.table = this.calculateTable(match_tweets)
    this.replay_state = "finished"
  }

  setLoading(loading) {
    this.loading = loading
  }

  getLoading () {
    return this.loading
  }

  setReplayState (replay_state) {
    this.replay_state = replay_state
  }

  getReplayState () {
    return this.replay_state
  }

  getIndex () {
    return this.index
  }

  getMatchTweetsTable () {
    return this.table.sort((a, b) => b.total - a.total)
  }

  getMatchEvents () {
    const match_events = this.fixtures.map(f => {
      return (f.events || []).map(e => {
        return {
          team: e.team,
          min: parseInt(e.min, 10),
          type: e.type,
          player: e.player
        }
      })
    }).reduce((previous, next) => previous.concat(next)).filter(e => {
      return ((e.min > 45 ? e.min + 15 : e.min) * 60) < this.cursor
    }).sort((a, b) => a.min - b.min)

    return match_events
  }

  liveEvents (event) {
    console.log('called liveEvents')
    console.log(event)
    if (event.gameweek !== parseInt(this.index, 10)) {
      return
    }

    const fixture = this.fixtures.find(elem => elem.home === event.events.home && elem.away === event.events.away)
    if (!fixture) {
      console.log('Unable to find fixture for match event', event)
      return
    }

    fixture.goals = event.events.goals
    fixture.events = event.events.events
    const match_tweets = this._getMatchTweets(0, this.cursor)
    this.table = this.calculateTable(match_tweets)
  }

  liveUpdate (tweet) {
    console.log(tweet)
    if (tweet.gameweek !== parseInt(this.index, 10)) {
      return
    }

    const tweet_fixtures = new Set()
    const second = this.tweets[tweet.seconds] || {}
    tweet.teams.forEach(team => {
      const fixture = this.fixtures.findIndex(elem => elem.home === team || elem.away === team)

      if (!tweet_fixtures.has(fixture)) {
        const mentions = second[fixture] || [0, 0, 0]

        mentions[0] += 1
        if (tweet.sentiment === 1) {
          mentions[1] += tweet.sentiment
        } else if (tweet.sentiment === -1) {
          mentions[2] += tweet.sentiment
        }

        second[fixture] = mentions
        tweet_fixtures.add(fixture)
      }
    })
    this.tweets[tweet.seconds] = second

    if (tweet.seconds <= this.cursor) {
      const match_tweets = this._getMatchTweets(0, this.cursor)
      this.table = this.calculateTable(match_tweets)
    }
  }

  calculateTable (fixture_tweet_counts) {
    const tweets_table = []
    fixture_tweet_counts.forEach((counts, fixture) => {
      tweets_table.push({home_goals: counts.home_goals, away_goals: counts.away_goals, total: counts.total, positive: counts.positive, 
        negative: counts.negative, home: fixture.home, away: fixture.away})
    })
    return tweets_table
  }

  getCursor () {
    return this.cursor
  }

  updateCursor (cursor) {
    if (cursor === this.cursor) return

    if (cursor < this.cursor) {
      const match_tweets = this._getMatchTweets(0, cursor)
      this.table = this.calculateTable(match_tweets)
    } else {
      const match_tweets = this._getMatchTweets(this.cursor + 1, cursor)
      const offset_table = this.calculateTable(match_tweets)
      offset_table.forEach(details => {
        const previous = this.table.find(item => (item.home === details.home && item.away === details.away))
        if (previous) {
          ['total', 'positive', 'negative', 'home_goals', 'away_goals'].forEach(label => previous[label] += details[label])
        } else {
          this.table.push(details)
        }
      })
    }

    this.cursor = cursor
  }

  _getMatchTweets (start, end) {
    const counts = new Map()
    this.fixtures.forEach(f => {
      let home_goals = 0, away_goals = 0;
      (f.events || []).forEach(event => {
        let event_minute = parseInt(event.min, 10)
        if (event_minute > 45) {
          event_minute += 15
        }
        const event_second = event_minute * 60
        if (event.type.match('goal') && start <= event_second && event_second <= end) {
          if (event.team === f.home) {
            home_goals++
          } else {
            away_goals++
          }
        }
      })
      counts.set(f, {total: 0, positive: 0, negative: 0, home_goals: home_goals, away_goals: away_goals})
    })
    while (start <= end) {
      for (let idx in this.tweets[start]) {
        const previous = counts.get(this.fixtures[idx])
        previous.total += this.tweets[start][idx][0]
        previous.positive += this.tweets[start][idx][1]
        previous.negative -= this.tweets[start][idx][2]
      }
      start++
    }
    return counts
  }

  emitChange () {
    this.emit(CHANGE_EVENT)
  }

  addChangeListener (callback) {
    this.on(CHANGE_EVENT, callback)
  }

  removeChangeListener (callback) {
    this.removeListener(CHANGE_EVENT, callback)
  }
}

let gameweek = new Gameweek()

Dispatcher.register(action => {
  switch (action.actionType) {
    case Constants.GAME_WEEK_CHANGE:
      gameweek.setLoading(true)
      gameweek.emitChange()
      break
    case Constants.GAME_WEEK_LOADED:
      gameweek.load(action.gameweek, action.fixtures, action.tweets)
      gameweek.emitChange()
      break
    case Constants.GAME_WEEK_UPDATE_CURSOR:
      gameweek.updateCursor(action.cursor)
      gameweek.emitChange()
      break
    case Constants.GAME_WEEK_LIVE_UPDATE:
      gameweek.liveUpdate(action.tweet)
      gameweek.emitChange()
      break
    case Constants.GAME_WEEK_LIVE_EVENTS:
      gameweek.liveEvents(action.events)
      gameweek.emitChange()
      break
    case Constants.REPLAY_LIVE:
      gameweek.setReplayState('live')
      gameweek.emitChange()
      break
    case Constants.REPLAY_PAUSED:
      gameweek.setReplayState('paused')
      gameweek.emitChange()
      break
    case Constants.REPLAY_FINISHED:
      gameweek.setReplayState('finished')
      gameweek.updateCursor(7200)
      gameweek.emitChange()
      break
  }
})

export default gameweek
